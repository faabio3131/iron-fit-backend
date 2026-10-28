import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const reference = 'isv_' + 'A'.repeat(43);

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'iron-local-vault-'));
  const directory = join(root, 'records');
  const keyFile = join(root, 'master-key');
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(keyFile, Buffer.alloc(32, 7).toString('base64') + '\n', { mode: 0o600 });
  await chmod(keyFile, 0o600);
  const { LocalEncryptedIntegrationSecretVaultAdapter } = require(
    '../dist/src/modules/integrations/secrets/local/local-encrypted-integration-secret-vault.adapter.js'
  );
  const adapter = new LocalEncryptedIntegrationSecretVaultAdapter({
    requireSettings: () => ({ directory, masterKeyFile: keyFile }),
  });
  return { root, directory, keyFile, adapter };
}

test('LOCAL_ENCRYPTED vault encrypts, resolves, rotates and revokes without plaintext at rest', async () => {
  const h = await harness();
  try {
    assert.deepEqual(await h.adapter.putSecret({ reference, value: 'gemini-secret' }), {
      version: 1, expiresAt: null,
    });
    assert.deepEqual(await h.adapter.getSecret(reference), {
      value: 'gemini-secret', version: 1, expiresAt: null,
    });
    const recordPath = join(h.directory, reference + '.json');
    const stored = await readFile(recordPath, 'utf8');
    assert.equal(stored.includes('gemini-secret'), false);
    assert.equal(JSON.parse(stored).algorithm, 'aes-256-gcm');

    assert.deepEqual(await h.adapter.putSecret({ reference, value: 'gemini-secret' }), {
      version: 1, expiresAt: null,
    });
    await assert.rejects(
      () => h.adapter.putSecret({ reference, value: 'different' }),
      /secretReference ja existe/,
    );
    await assert.rejects(
      () => h.adapter.putSecret({ reference, value: 'rotated', expectedVersion: 9 }),
      /Versao esperada/,
    );
    assert.deepEqual(
      await h.adapter.putSecret({ reference, value: 'rotated', expectedVersion: 1 }),
      { version: 2, expiresAt: null },
    );
    assert.equal((await h.adapter.getSecret(reference)).value, 'rotated');
    await h.adapter.revokeSecret(reference);
    await assert.rejects(() => h.adapter.getSecret(reference), /Segredo indisponivel/);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('LOCAL_ENCRYPTED vault fails closed on tampering and unsafe master-key permissions', async () => {
  const h = await harness();
  try {
    await h.adapter.putSecret({ reference, value: 'protected' });
    const recordPath = join(h.directory, reference + '.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    record.ciphertext = Buffer.from('tampered').toString('base64');
    await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
    await assert.rejects(() => h.adapter.getSecret(reference), /Segredo indisponivel/);

    await chmod(h.keyFile, 0o644);
    await assert.rejects(
      () => h.adapter.inspectSecret(reference),
      /Chave mestra.*indisponivel/,
    );
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('production runtime accepts only physical OCI or LOCAL_ENCRYPTED vault backends', () => {
  const source = readFileSync('src/config/runtime-environment.ts', 'utf8');
  assert.match(source, /\['OCI', 'LOCAL_ENCRYPTED'\]/);
  const moduleSource = readFileSync(
    'src/modules/integrations/integrations.module.ts', 'utf8',
  );
  assert.match(moduleSource, /backend === 'LOCAL_ENCRYPTED'/);
  assert.match(moduleSource, /LocalEncryptedIntegrationSecretVaultAdapter/);
});
