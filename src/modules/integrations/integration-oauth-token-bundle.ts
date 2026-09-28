import { ServiceUnavailableException } from '@nestjs/common';
import { OAuthTokenSet } from './integration-oauth-provider-adapters';
import { IntegrationSecretValue } from './secrets/integration-secret-vault.port';

type OAuthVaultBundle = {
  schemaVersion: 1;
  providerCode: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  grantedScopes: string[];
  issuedAt: string;
  accessExpiresAt: string | null;
};

export interface ParsedOAuthTokenBundle {
  providerCode: string;
  accessToken: IntegrationSecretValue;
  refreshToken: IntegrationSecretValue | null;
  tokenType: string | null;
  grantedScopes: string[];
  issuedAt: Date;
  accessExpiresAt: Date | null;
}

function boundedSecret(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 32_768) {
    throw new ServiceUnavailableException(
      'OAuth credential bundle invalido: ' + field,
    );
  }
  return raw;
}

function validDate(raw: unknown, field: string, optional: boolean): Date | null {
  if ((raw === null || raw === undefined || raw === '') && optional) return null;
  if (typeof raw !== 'string') {
    throw new ServiceUnavailableException(
      'OAuth credential bundle invalido: ' + field,
    );
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new ServiceUnavailableException(
      'OAuth credential bundle invalido: ' + field,
    );
  }
  return date;
}

export function serializeOAuthTokenBundle(
  providerCode: string,
  tokenSet: OAuthTokenSet,
  issuedAt: Date,
): string {
  const bundle: OAuthVaultBundle = {
    schemaVersion: 1,
    providerCode,
    accessToken: tokenSet.accessToken.reveal(),
    refreshToken: tokenSet.refreshToken?.reveal() ?? null,
    tokenType: tokenSet.tokenType,
    grantedScopes: [...tokenSet.grantedScopes],
    issuedAt: issuedAt.toISOString(),
    accessExpiresAt: tokenSet.accessExpiresAt?.toISOString() ?? null,
  };
  return JSON.stringify(bundle);
}

export function parseOAuthTokenBundle(
  raw: string,
  expectedProviderCode: string,
): ParsedOAuthTokenBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ServiceUnavailableException(
      'OAuth credential bundle invalido',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceUnavailableException(
      'OAuth credential bundle invalido',
    );
  }

  const bundle = parsed as Record<string, unknown>;
  if (
    bundle.schemaVersion !== 1 ||
    bundle.providerCode !== expectedProviderCode
  ) {
    throw new ServiceUnavailableException(
      'OAuth credential bundle diverge do provider canonico',
    );
  }

  const accessToken = boundedSecret(bundle.accessToken, 'accessToken');
  const refreshToken =
    bundle.refreshToken === null || bundle.refreshToken === undefined
      ? null
      : boundedSecret(bundle.refreshToken, 'refreshToken');

  const tokenType =
    bundle.tokenType === null || bundle.tokenType === undefined
      ? null
      : typeof bundle.tokenType === 'string' && bundle.tokenType.length <= 64
        ? bundle.tokenType
        : null;
  if (bundle.tokenType !== null && bundle.tokenType !== undefined && !tokenType) {
    throw new ServiceUnavailableException(
      'OAuth credential bundle invalido: tokenType',
    );
  }

  if (
    !Array.isArray(bundle.grantedScopes) ||
    bundle.grantedScopes.some(
      (scope) =>
        typeof scope !== 'string' ||
        !scope.trim() ||
        scope.length > 512,
    )
  ) {
    throw new ServiceUnavailableException(
      'OAuth credential bundle invalido: grantedScopes',
    );
  }

  return {
    providerCode: expectedProviderCode,
    accessToken: new IntegrationSecretValue(accessToken),
    refreshToken: refreshToken
      ? new IntegrationSecretValue(refreshToken)
      : null,
    tokenType,
    grantedScopes: [
      ...new Set(
        (bundle.grantedScopes as string[]).map((scope) => scope.trim()),
      ),
    ].sort(),
    issuedAt: validDate(bundle.issuedAt, 'issuedAt', false)!,
    accessExpiresAt: validDate(
      bundle.accessExpiresAt,
      'accessExpiresAt',
      true,
    ),
  };
}
