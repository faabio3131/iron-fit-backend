import { ServiceUnavailableException } from '@nestjs/common';
import { IntegrationSecretValue } from './secrets/integration-secret-vault.port';

const OAUTH_HTTP_TIMEOUT_MS = 20_000;
const OAUTH_MAX_RESPONSE_BYTES = 64 * 1024;

export interface OAuthAppPublicConfiguration {
  clientId: string;
  exchangeEndpoint: string;
  revocationEndpoint: string | null;
  authorizationParams: Record<string, string>;
}

export interface OAuthTokenSet {
  accessToken: IntegrationSecretValue;
  refreshToken: IntegrationSecretValue | null;
  tokenType: string | null;
  grantedScopes: string[];
  accessExpiresAt: Date | null;
}

export interface OAuthExchangeInput {
  configuration: OAuthAppPublicConfiguration;
  clientSecret: IntegrationSecretValue;
  authorizationCode: IntegrationSecretValue;
  redirectUri: string;
  requestedScopes: readonly string[];
  pkceVerifier: IntegrationSecretValue | null;
}

export interface OAuthRefreshInput {
  configuration: OAuthAppPublicConfiguration;
  clientSecret: IntegrationSecretValue;
  refreshToken: IntegrationSecretValue;
  requestedScopes: readonly string[];
}

export interface OAuthRevokeInput {
  configuration: OAuthAppPublicConfiguration;
  accessToken: IntegrationSecretValue;
  refreshToken: IntegrationSecretValue | null;
}

export interface IntegrationOAuthProviderAdapter {
  readonly providerCode: string;
  exchange(input: OAuthExchangeInput): Promise<OAuthTokenSet>;
  refresh?(input: OAuthRefreshInput): Promise<OAuthTokenSet>;
  revoke?(input: OAuthRevokeInput): Promise<void>;
}

function httpsEndpoint(raw: unknown, field: string, optional = false): string | null {
  if ((raw === null || raw === undefined || raw === '') && optional) return null;
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
  return parsed.toString();
}

export function parseOAuthAppPublicConfiguration(
  raw: unknown,
): OAuthAppPublicConfiguration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ServiceUnavailableException(
      'OAuth App global sem publicConfiguration',
    );
  }
  const configuration = raw as Record<string, unknown>;
  const clientId =
    typeof configuration.clientId === 'string'
      ? configuration.clientId.trim()
      : '';
  if (!clientId || clientId.length > 512) {
    throw new ServiceUnavailableException('OAuth clientId global invalido');
  }

  const authorizationParams: Record<string, string> = {};
  if (configuration.authorizationParams !== undefined) {
    if (
      !configuration.authorizationParams ||
      typeof configuration.authorizationParams !== 'object' ||
      Array.isArray(configuration.authorizationParams)
    ) {
      throw new ServiceUnavailableException(
        'OAuth authorizationParams global invalido',
      );
    }
    for (const [key, value] of Object.entries(
      configuration.authorizationParams as Record<string, unknown>,
    )) {
      if (typeof value !== 'string' || value.length > 512) {
        throw new ServiceUnavailableException(
          'OAuth authorizationParams global contem entrada invalida',
        );
      }
      authorizationParams[key] = value;
    }
  }

  return {
    clientId,
    exchangeEndpoint: httpsEndpoint(
      configuration.exchangeEndpoint,
      'OAuth exchangeEndpoint',
    )!,
    revocationEndpoint: httpsEndpoint(
      configuration.revocationEndpoint,
      'OAuth revocationEndpoint',
      true,
    ),
    authorizationParams,
  };
}

type OAuthHttpResponse = {
  status: number;
  payload: Record<string, unknown>;
};

export class IntegrationOAuthHttpTransport {
  async postForm(
    endpoint: string,
    body: Readonly<Record<string, string>>,
  ): Promise<OAuthHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OAUTH_HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams(body).toString(),
        redirect: 'error',
        signal: controller.signal,
      });

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > OAUTH_MAX_RESPONSE_BYTES) {
        throw new ServiceUnavailableException(
          'Resposta OAuth excedeu limite seguro',
        );
      }

      let payload: Record<string, unknown> = {};
      if (text.trim()) {
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('shape');
          }
          payload = parsed as Record<string, unknown>;
        } catch {
          throw new ServiceUnavailableException(
            'Provider OAuth retornou resposta invalida',
          );
        }
      }

      if (!response.ok) {
        throw new ServiceUnavailableException(
          'Provider OAuth rejeitou a operacao (HTTP ' + response.status + ')',
        );
      }
      return { status: response.status, payload };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Provider OAuth indisponivel ou timeout',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function positiveExpiresIn(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const seconds =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 315_360_000) {
    throw new ServiceUnavailableException(
      'Provider OAuth retornou expires_in invalido',
    );
  }
  return seconds;
}

function tokenSet(
  payload: Record<string, unknown>,
  requestedScopes: readonly string[],
): OAuthTokenSet {
  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
  if (!accessToken || accessToken.length > 32_768) {
    throw new ServiceUnavailableException(
      'Provider OAuth nao retornou access token valido',
    );
  }

  const refreshToken =
    typeof payload.refresh_token === 'string' && payload.refresh_token.trim()
      ? new IntegrationSecretValue(payload.refresh_token.trim())
      : null;
  const tokenType =
    typeof payload.token_type === 'string' && payload.token_type.trim()
      ? payload.token_type.trim().slice(0, 64)
      : null;
  const expiresIn = positiveExpiresIn(payload.expires_in);

  const responseScopes =
    typeof payload.scope === 'string'
      ? payload.scope
          .split(/[ ,]+/)
          .map((scope) => scope.trim())
          .filter(Boolean)
      : [];

  const grantedScopes = responseScopes.length
    ? [...new Set(responseScopes)].sort()
    : [...new Set(requestedScopes)].sort();

  if (
    responseScopes.length &&
    requestedScopes.some((scope) => !grantedScopes.includes(scope))
  ) {
    throw new ServiceUnavailableException(
      'Provider OAuth nao concedeu todos os scopes governados',
    );
  }

  return {
    accessToken: new IntegrationSecretValue(accessToken),
    refreshToken,
    tokenType,
    grantedScopes,
    accessExpiresAt: expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null,
  };
}

export class MetaOAuthProviderAdapter
  implements IntegrationOAuthProviderAdapter
{
  readonly providerCode = 'meta';

  constructor(private readonly http: IntegrationOAuthHttpTransport) {}

  async exchange(input: OAuthExchangeInput): Promise<OAuthTokenSet> {
    const body: Record<string, string> = {
      client_id: input.configuration.clientId,
      client_secret: input.clientSecret.reveal(),
      code: input.authorizationCode.reveal(),
      redirect_uri: input.redirectUri,
    };
    if (input.pkceVerifier) {
      body.code_verifier = input.pkceVerifier.reveal();
    }
    const response = await this.http.postForm(
      input.configuration.exchangeEndpoint,
      body,
    );
    return tokenSet(response.payload, input.requestedScopes);
  }
}

export class GoogleOAuthProviderAdapter
  implements IntegrationOAuthProviderAdapter
{
  readonly providerCode = 'google';

  constructor(private readonly http: IntegrationOAuthHttpTransport) {}

  async exchange(input: OAuthExchangeInput): Promise<OAuthTokenSet> {
    if (input.configuration.authorizationParams.access_type !== 'offline') {
      throw new ServiceUnavailableException(
        'Google OAuth exige access_type=offline para refresh governado',
      );
    }
    const body: Record<string, string> = {
      client_id: input.configuration.clientId,
      client_secret: input.clientSecret.reveal(),
      code: input.authorizationCode.reveal(),
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    };
    if (input.pkceVerifier) {
      body.code_verifier = input.pkceVerifier.reveal();
    }
    const response = await this.http.postForm(
      input.configuration.exchangeEndpoint,
      body,
    );
    return tokenSet(response.payload, input.requestedScopes);
  }

  async refresh(input: OAuthRefreshInput): Promise<OAuthTokenSet> {
    const response = await this.http.postForm(
      input.configuration.exchangeEndpoint,
      {
        client_id: input.configuration.clientId,
        client_secret: input.clientSecret.reveal(),
        refresh_token: input.refreshToken.reveal(),
        grant_type: 'refresh_token',
      },
    );
    const refreshed = tokenSet(response.payload, input.requestedScopes);
    return {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? input.refreshToken,
    };
  }

  async revoke(input: OAuthRevokeInput): Promise<void> {
    if (!input.configuration.revocationEndpoint) {
      throw new ServiceUnavailableException(
        'Google OAuth revocationEndpoint nao configurado',
      );
    }
    await this.http.postForm(input.configuration.revocationEndpoint, {
      token: (input.refreshToken ?? input.accessToken).reveal(),
    });
  }
}
