import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { assertIntegrationSecretReference } from '../../contracts/integration-contract';
import {
  IntegrationSecretVaultPort,
  VaultSecretMetadata,
  VaultSecretSnapshot,
} from '../integration-secret-vault.port';
import {
  LocalEncryptedVaultConfigurationService,
  LocalEncryptedVaultSettings,
} from './local-encrypted-vault-configuration.service';

const MAX_SECRET_BYTES = 25 * 1024;
const RECORD_FORMAT = 'IRON_LOCAL_ENCRYPTED_VAULT_V1';

interface EncryptedRecord {
  format: typeof RECORD_FORMAT;
  reference: string;
  version: number;
  algorithm: 'aes-256-gcm';
  nonce: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertValue(value: string): Buffer {
  const bytes = Buffer.from(value ?? '', 'utf8');
  if (!bytes.length) throw new ConflictException('Segredo de integracao vazio');
  if (bytes.length > MAX_SECRET_BYTES) {
    throw new ConflictException('Segredo de integracao excede limite de 25 KB');
  }
  return bytes;
}

@Injectable()
export class LocalEncryptedIntegrationSecretVaultAdapter implements IntegrationSecretVaultPort {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly configuration: LocalEncryptedVaultConfigurationService) {}

  private path(settings: LocalEncryptedVaultSettings, reference: string): string {
    return join(settings.directory, basename(assertIntegrationSecretReference(reference)) + '.json');
  }

  private async key(settings: LocalEncryptedVaultSettings): Promise<Buffer> {
    try {
      const metadata = await stat(settings.masterKeyFile);
      if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
        throw new Error('permissoes inseguras');
      }
      const raw = (await readFile(settings.masterKeyFile, 'utf8')).trim();
      const key = /^[a-f0-9]{64}$/i.test(raw)
        ? Buffer.from(raw, 'hex')
        : Buffer.from(raw, 'base64');
      if (key.length !== 32) throw new Error('tamanho invalido');
      return key;
    } catch {
      throw new ServiceUnavailableException('Chave mestra do LOCAL_ENCRYPTED Vault indisponivel');
    }
  }

  private async prepare(): Promise<{ settings: LocalEncryptedVaultSettings; key: Buffer }> {
    const settings = this.configuration.requireSettings();
    try {
      await mkdir(settings.directory, { recursive: true, mode: 0o700 });
      await access(settings.directory, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
      const metadata = await stat(settings.directory);
      if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
        throw new Error('diretorio inseguro');
      }
    } catch {
      throw new ServiceUnavailableException('Diretorio do LOCAL_ENCRYPTED Vault indisponivel');
    }
    return { settings, key: await this.key(settings) };
  }

  private aad(reference: string, version: number): Buffer {
    return Buffer.from(RECORD_FORMAT + ':' + reference + ':' + version, 'utf8');
  }

  private encrypt(reference: string, version: number, value: Buffer, key: Buffer): EncryptedRecord {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(this.aad(reference, version));
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    return {
      format: RECORD_FORMAT,
      reference,
      version,
      algorithm: 'aes-256-gcm',
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      createdAt: new Date().toISOString(),
    };
  }

  private decrypt(record: EncryptedRecord, expectedReference: string, key: Buffer): string {
    if (record.format !== RECORD_FORMAT || record.algorithm !== 'aes-256-gcm'
      || record.reference !== expectedReference || !Number.isSafeInteger(record.version)
      || record.version < 1) throw new Error('registro invalido');
    const decipher = createDecipheriv(
      'aes-256-gcm', key, Buffer.from(record.nonce, 'base64'),
    );
    decipher.setAAD(this.aad(record.reference, record.version));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private async read(reference: string, settings: LocalEncryptedVaultSettings, key: Buffer) {
    try {
      const serialized = await readFile(this.path(settings, reference), 'utf8');
      const record = JSON.parse(serialized) as EncryptedRecord;
      return { record, value: this.decrypt(record, reference, key) };
    } catch {
      throw new ServiceUnavailableException('Segredo indisponivel no LOCAL_ENCRYPTED Vault');
    }
  }

  private async atomicWrite(path: string, record: EncryptedRecord): Promise<void> {
    const temporary = path + '.' + process.pid + '.' + randomBytes(8).toString('hex') + '.tmp';
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record), { encoding: 'utf8' });
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
    } catch {
      try { await handle?.close(); } catch { /* best effort */ }
      try { await unlink(temporary); } catch { /* best effort */ }
      throw new ServiceUnavailableException('Falha atomica ao persistir segredo criptografado');
    }
  }

  private async serialize<T>(reference: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(reference) ?? Promise.resolve();
    const current = prior.catch(() => undefined).then(operation);
    this.queues.set(reference, current);
    try { return await current; } finally {
      if (this.queues.get(reference) === current) this.queues.delete(reference);
    }
  }

  async putSecret(input: {
    reference: string;
    value: string;
    expectedVersion?: number;
  }): Promise<{ version: number; expiresAt?: Date | null }> {
    const reference = assertIntegrationSecretReference(input.reference);
    const value = assertValue(input.value);
    return this.serialize(reference, async () => {
      const { settings, key } = await this.prepare();
      const path = this.path(settings, reference);
      let existing: { record: EncryptedRecord; value: string } | undefined;
      let exists = true;
      try { await access(path, fsConstants.F_OK); } catch { exists = false; }
      if (exists) existing = await this.read(reference, settings, key);

      if (input.expectedVersion === undefined) {
        if (existing) {
          if (!sameSecret(existing.value, input.value)) {
            throw new ConflictException('secretReference ja existe com outro conteudo');
          }
          return { version: existing.record.version, expiresAt: null };
        }
        await this.atomicWrite(path, this.encrypt(reference, 1, value, key));
        return { version: 1, expiresAt: null };
      }

      if (!existing || existing.record.version !== input.expectedVersion) {
        throw new ConflictException('Versao esperada do segredo diverge do Vault');
      }
      const version = input.expectedVersion + 1;
      await this.atomicWrite(path, this.encrypt(reference, version, value, key));
      return { version, expiresAt: null };
    });
  }

  async getSecret(reference: string): Promise<VaultSecretSnapshot> {
    const safe = assertIntegrationSecretReference(reference);
    const { settings, key } = await this.prepare();
    const current = await this.read(safe, settings, key);
    return { value: current.value, version: current.record.version, expiresAt: null };
  }

  async inspectSecret(reference: string): Promise<VaultSecretMetadata> {
    const current = await this.getSecret(reference);
    return { version: current.version, expiresAt: null };
  }

  async revokeSecret(reference: string): Promise<void> {
    const safe = assertIntegrationSecretReference(reference);
    await this.serialize(safe, async () => {
      const { settings } = await this.prepare();
      try { await unlink(this.path(settings, safe)); } catch {
        throw new ServiceUnavailableException('Falha ao revogar segredo criptografado');
      }
    });
  }
}
