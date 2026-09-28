import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationSecretValue } from './secrets/integration-secret-vault.port';

export type OAuthRefreshMode = 'REFRESH_TOKEN' | 'REAUTHORIZE';
export type OAuthClientAuthMode = 'BODY' | 'BASIC';

export type OAuthProviderPublicConfiguration = {
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  clientAuthMode: OAuthClientAuthMode;
  refreshMode: OAuthRefreshMode;
  tokenRequestParams: Record<string, string>;
};

export type OAuthTokenBundle = {
  accessToken: IntegrationSecretValue;
  refreshToken: IntegrationSecretValue | null;
  tokenType: string | null;
  grantedScopes: string[];
  accessTokenExpiresAt: Date | null;
};

export type OAuthExchangeInput = {
  providerCode: string;
  publicConfiguration: Readonly<Record<string, unknown>>;
  clientSecret: IntegrationSecretValue;
  authorizationCode: IntegrationSecretValue;
  redirectUri: string;
  pkceVerifier: IntegrationSecretValue | null;
  requestedScopes: readonly string[];
};

export type OAuthRefreshInput = {
  providerCode: string;
  publicConfiguration: Readonly<Record<string, unknown>>;
  clientSecret: IntegrationSecretValue;
  refreshToken: IntegrationSecretValue;
  previousScopes: readonly string[];
};

export interface IntegrationOAuthProviderAdapter {
  readonly providerCode: string;
  exchangeCode(input: OAuthExchangeInput): Promise<OAuthTokenBundle>;
  refresh(input: OAuthRefreshInput): Promise<OAuthTokenBundle>;
  revoke?(
    publicConfiguration: Readonly<Record<string, unknown>>,
    clientSecret: IntegrationSecretValue,
    token: IntegrationSecretValue,
  ): Promise<void>;
}

const RESERVED_TOKEN_PARAMS = new Set([
  'client_id',
  'client_secret',
  'code',
  'code_verifier',
  'grant_type',
  'redirect_uri',
  'refresh_token',
]);

function httpsEndpoint(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ServiceUnavailableException(field + ' nao configurado');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ServiceUnavailableException(field + ' invalido');
  }
  if (parsed.protocol !== 'https:') {
    throw new ServiceUnavailableException(field + ' deve usar HTTPS');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.hostname === 'localhost' ||
    parsed.hostname.endsWith('.local')
  ) {
    throw new ServiceUnavailableException(field + ' aponta para host proibido');
  }
  return parsed.toString();
}

export function parseOAuthProviderConfiguration(
  raw: Readonly<Record<string, unknown>>,
): OAuthProviderPublicConfiguration {
  const clientId =
    typeof raw.clientId === 'string' ? raw.clientId.trim() : '';
  if (!clientId || clientId.length > 512) {
    throw new ServiceUnavailableException('OAuth clientId invalido');
  }
  const tokenEndpoint = httpsEndpoint(raw.tokenEndpoint, 'OAuth tokenEndpoint');
  const revocationEndpoint =
    raw.revocationEndpoint === undefined || raw.revocationEndpoint === null
      ? null
      : httpsEndpoint(raw.revocationEndpoint, 'OAuth revocationEndpoint');

  const clientAuthMode =
    raw.clientAuthMode === 'BODY' || raw.clientAuthMode === 'BASIC'
      ? raw.clientAuthMode
      : null;
  if (!clientAuthMode) {
    throw new ServiceUnavailableException(
      'OAuth clientAuthMode deve ser BODY ou BASIC',
    );
  }

  const refreshMode =
    raw.refreshMode === 'REFRESH_TOKEN' || raw.refreshMode === 'REAUTHORIZE'
      ? raw.refreshMode
      : null;
  if (!refreshMode) {
    throw new ServiceUnavailableException(
      'OAuth refreshMode deve ser REFRESH_TOKEN ou REAUTHORIZE',
    );
  }

  const tokenRequestParams: Record<string, string> = {};
  if (raw.tokenRequestParams !== undefined) {
    if (
      !raw.tokenRequestParams ||
      typeof raw.tokenRequestParams !== 'object' ||
      Array.isArray(raw.tokenRequestParams)
    ) {
      throw new ServiceUnavailableException(
        'OAuth tokenRequestParams invalido',
      );
    }
    for (const [key, value] of Object.entries(
      raw.tokenRequestParams as Record<string, unknown>,
    )) {
      if (RESERVED_TOKEN_PARAMS.has(key)) {
        throw new ServiceUnavailableException(
          'OAuth tokenRequestParams tenta sobrescrever parametro reservado',
        );
      }
      if (
        !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ||
        typeof value !== 'string' ||
        value.length > 512
      ) {
        throw new ServiceUnavailableException(
          'OAuth tokenRequestParams contem entrada invalida',
        );
      }
      tokenRequestParams[key] = value;
    }
  }

  return {
    clientId,
    tokenEndpoint,
    revocationEndpoint,
    clientAuthMode,
    refreshMode,
    tokenRequestParams,
  };
}

function normalizeScopes(raw: unknown, fallback: readonly string[]): string[] {
  if (typeof raw === 'string') {
    const values = raw.split(/\s+/).map((value) => value.trim()).filter(Boolean);
    if (values.length) return [...new Set(values)].sort();
  }
  if (Array.isArray(raw)) {
    const values = raw.filter(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    );
    if (values.length === raw.length && values.length) {
      return [...new Set(values.map((value) => value.trim()))].sort();
    }
  }
  return [...new Set(fallback)].sort();
}

function tokenExpiry(expiresIn: unknown): Date | null {
  const seconds =
    typeof expiresIn === 'number'
      ? expiresIn
      : typeof expiresIn === 'string' && /^\d+$/.test(expiresIn)
        ? Number(expiresIn)
        : null;
  if (
    seconds === null ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 366 * 24 * 60 * 60
  ) {
    return null;
  }
  return new Date(Date.now() + seconds * 1000);
}

abstract class StandardOAuth2Adapter
  implements IntegrationOAuthProviderAdapter
{
  abstract readonly providerCode: string;

  private async tokenRequest(
    configuration: OAuthProviderPublicConfiguration,
    clientSecret: IntegrationSecretValue,
    params: URLSearchParams,
    fallbackScopes: readonly string[],
  ): Promise<OAuthTokenBundle> {
    for (const [key, value] of Object.entries(
      configuration.tokenRequestParams,
    )) {
      params.set(key, value);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (configuration.clientAuthMode === 'BASIC') {
      headers.Authorization =
        'Basic ' +
        Buffer.from(
          configuration.clientId + ':' + clientSecret.reveal(),
          'utf8',
        ).toString('base64');
      params.set('client_id', configuration.clientId);
    } else {
      params.set('client_id', configuration.clientId);
      params.set('client_secret', clientSecret.reveal());
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(configuration.tokenEndpoint, {
        method: 'POST',
        headers,
        body: params,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException(
        'OAuth provider indisponivel durante token exchange',
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // Provider response remains sanitized below.
    }

    if (!response.ok) {
      const errorCode =
        typeof payload.error === 'string' &&
        /^[A-Za-z0-9_.:-]{1,128}$/.test(payload.error)
          ? payload.error
          : 'provider_error';
      throw new ServiceUnavailableException(
        'OAuth token exchange falhou: HTTP ' +
          response.status +
          ' / ' +
          errorCode,
      );
    }

    const accessToken =
      typeof payload.access_token === 'string' ? payload.access_token : '';
    if (!accessToken) {
      throw new ServiceUnavailableException(
        'OAuth provider nao retornou access_token',
      );
    }
    const refreshToken =
      typeof payload.refresh_token === 'string' && payload.refresh_token
        ? new IntegrationSecretValue(payload.refresh_token)
        : null;
    const tokenType =
      typeof payload.token_type === 'string' && payload.token_type.length <= 64
        ? payload.token_type
        : null;

    return {
      accessToken: new IntegrationSecretValue(accessToken),
      refreshToken,
      tokenType,
      grantedScopes: normalizeScopes(payload.scope, fallbackScopes),
      accessTokenExpiresAt: tokenExpiry(payload.expires_in),
    };
  }

  async exchangeCode(input: OAuthExchangeInput): Promise<OAuthTokenBundle> {
    const configuration = parseOAuthProviderConfiguration(
      input.publicConfiguration,
    );
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.authorizationCode.reveal(),
      redirect_uri: input.redirectUri,
    });
    if (input.pkceVerifier) {
      params.set('code_verifier', input.pkceVerifier.reveal());
    }
    return this.tokenRequest(
      configuration,
      input.clientSecret,
      params,
      input.requestedScopes,
    );
  }

  async refresh(input: OAuthRefreshInput): Promise<OAuthTokenBundle> {
    const configuration = parseOAuthProviderConfiguration(
      input.publicConfiguration,
    );
    if (configuration.refreshMode !== 'REFRESH_TOKEN') {
      throw new BadRequestException(
        'Provider exige reautorizacao em vez de refresh_token',
      );
    }
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken.reveal(),
    });
    return this.tokenRequest(
      configuration,
      input.clientSecret,
      params,
      input.previousScopes,
    );
  }

  async revoke(
    publicConfiguration: Readonly<Record<string, unknown>>,
    clientSecret: IntegrationSecretValue,
    token: IntegrationSecretValue,
  ): Promise<void> {
    const configuration = parseOAuthProviderConfiguration(publicConfiguration);
    if (!configuration.revocationEndpoint) return;

    const params = new URLSearchParams({ token: token.reveal() });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (configuration.clientAuthMode === 'BASIC') {
      headers.Authorization =
        'Basic ' +
        Buffer.from(
          configuration.clientId + ':' + clientSecret.reveal(),
          'utf8',
        ).toString('base64');
    } else {
      params.set('client_id', configuration.clientId);
      params.set('client_secret', clientSecret.reveal());
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(configuration.revocationEndpoint, {
        method: 'POST',
        headers,
        body: params,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          'OAuth provider recusou revogacao: HTTP ' + response.status,
        );
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'OAuth provider indisponivel durante revogacao',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

@Injectable()
export class MetaOAuthProviderAdapter extends StandardOAuth2Adapter {
  readonly providerCode = 'meta';
}

@Injectable()
export class GoogleOAuthProviderAdapter extends StandardOAuth2Adapter {
  readonly providerCode = 'google';
}

@Injectable()
export class IntegrationOAuthProviderAdapterRegistry {
  private readonly adapters = new Map<
    string,
    IntegrationOAuthProviderAdapter
  >();

  register(adapter: IntegrationOAuthProviderAdapter) {
    if (this.adapters.has(adapter.providerCode)) {
      throw new Error(
        'OAuth adapter duplicado para ' + adapter.providerCode,
      );
    }
    this.adapters.set(adapter.providerCode, adapter);
  }

  require(providerCode: string): IntegrationOAuthProviderAdapter {
    const adapter = this.adapters.get(providerCode);
    if (!adapter) {
      throw new ServiceUnavailableException(
        'OAuth adapter nao configurado para ' + providerCode,
      );
    }
    return adapter;
  }
}
