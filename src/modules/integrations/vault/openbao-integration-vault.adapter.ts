import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IntegrationSecretPayload,
  IntegrationVaultPort,
  IntegrationVaultWriteResult,
} from '../contracts/integration-vault.port';

const MOUNT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

interface OpenBaoConfig {
  address: string;
  token: string;
  mount: string;
  timeoutMs: number;
}

@Injectable()
export class OpenBaoIntegrationVaultAdapter implements IntegrationVaultPort {
  constructor(private readonly configService: ConfigService) {}

  private configuration(): OpenBaoConfig {
    const rawAddress = this.configService
      .get<string>('INTEGRATION_VAULT_ADDR')
      ?.trim()
      .replace(/\/+$/, '');
    const token = this.configService
      .get<string>('INTEGRATION_VAULT_TOKEN')
      ?.trim();
    const mount =
      this.configService.get<string>('INTEGRATION_VAULT_MOUNT')?.trim() ||
      'secret';

    if (!rawAddress || !token || !MOUNT_PATTERN.test(mount)) {
      throw new ServiceUnavailableException(
        'Integration Secret Vault nao configurado',
      );
    }

    let url: URL;
    try {
      url = new URL(rawAddress);
    } catch {
      throw new ServiceUnavailableException(
        'Integration Secret Vault com endereco invalido',
      );
    }

    const nodeEnv = this.configService.get<string>('NODE_ENV')?.trim();
    const localHttp =
      (nodeEnv === 'test' || nodeEnv === 'development') &&
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname);

    if (url.protocol !== 'https:' && !localHttp) {
      throw new ServiceUnavailableException(
        'Integration Secret Vault exige HTTPS fora de ambiente local de teste',
      );
    }

    const timeoutRaw =
      this.configService.get<string>('INTEGRATION_VAULT_TIMEOUT_MS') ?? '5000';
    const timeoutMs = Number(timeoutRaw);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) {
      throw new ServiceUnavailableException(
        'INTEGRATION_VAULT_TIMEOUT_MS invalido',
      );
    }

    return {
      address: rawAddress,
      token,
      mount,
      timeoutMs,
    };
  }

  private encodedPath(referencePath: string) {
    const segments = referencePath.split('/');
    if (
      segments.length < 2 ||
      segments.some((segment) => !PATH_SEGMENT_PATTERN.test(segment))
    ) {
      throw new ServiceUnavailableException(
        'secret reference path invalido',
      );
    }
    return segments.map(encodeURIComponent).join('/');
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    body?: unknown,
  ) {
    const config = this.configuration();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.address}${endpoint}`, {
        method,
        headers: {
          'X-Vault-Token': config.token,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Integration Secret Vault indisponivel (HTTP ${response.status})`,
        );
      }

      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Integration Secret Vault indisponivel',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async put(
    referencePath: string,
    payload: IntegrationSecretPayload,
  ): Promise<IntegrationVaultWriteResult> {
    const config = this.configuration();
    const path = this.encodedPath(referencePath);
    const response = await this.request(
      'POST',
      `/v1/${encodeURIComponent(config.mount)}/data/${path}`,
      { data: { payload } },
    );
    const version = Number(response?.data?.version);
    if (!Number.isInteger(version) || version <= 0) {
      throw new ServiceUnavailableException(
        'Integration Secret Vault nao confirmou versao',
      );
    }
    return { version };
  }

  async get(referencePath: string): Promise<IntegrationSecretPayload> {
    const config = this.configuration();
    const path = this.encodedPath(referencePath);
    const response = await this.request(
      'GET',
      `/v1/${encodeURIComponent(config.mount)}/data/${path}`,
    );

    const payload = response?.data?.data?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ServiceUnavailableException(
        'Integration Secret Vault retornou payload invalido',
      );
    }

    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value !== 'string') {
        throw new ServiceUnavailableException(
          'Integration Secret Vault retornou valor invalido',
        );
      }
      output[key] = value;
    }

    return Object.freeze(output);
  }

  async destroy(referencePath: string): Promise<void> {
    const config = this.configuration();
    const path = this.encodedPath(referencePath);
    await this.request(
      'DELETE',
      `/v1/${encodeURIComponent(config.mount)}/metadata/${path}`,
    );
  }
}
