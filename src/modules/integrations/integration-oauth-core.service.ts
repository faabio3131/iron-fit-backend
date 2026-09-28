import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  REFRESH_SESSION_MAX_TTL_MS,
} from '../auth/auth-security';
import { AuthSecurityService } from '../auth/auth-security.service';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';
import {
  assertCapability,
  assertProviderCode,
  newIntegrationSecretReference,
} from './contracts/integration-contract';
import { StartIntegrationOAuthDto } from './dto/integration-oauth.dto';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretValue,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_BYTES = 32;
const PKCE_VERIFIER_BYTES = 64;
const RESERVED_AUTH_PARAMS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
]);

type OAuthAppConfiguration = {
  clientId: string;
  authorizationEndpoint: string;
  redirectUris: string[];
  capabilityScopes: Record<string, string[]>;
  pkceMode: 'S256' | 'NONE';
  authorizationParams: Record<string, string>;
};

type TenantOAuthActor = {
  userId: string;
  sessionId: string;
  gymId: string;
};

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlSha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function httpsUrl(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ServiceUnavailableException(field + ' nao configurado');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ServiceUnavailableException(field + ' invalido');
  }
  if (url.protocol !== 'https:') {
    throw new ServiceUnavailableException(field + ' deve usar HTTPS');
  }
  return url.toString();
}

function stringArray(raw: unknown, field: string): string[] {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new ServiceUnavailableException(field + ' deve ser array de strings nao vazio');
  }
  return [...new Set(raw.map((item) => item.trim()))];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

@Injectable()
export class IntegrationOAuthCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSecurity: AuthSecurityService,
    private readonly providers: IntegrationProviderRegistry,
    private readonly runtimeEnvironment: IntegrationRuntimeEnvironmentService,
    private readonly entitlements: TenantProductEntitlementsService,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private appConfiguration(connection: any): OAuthAppConfiguration {
    const raw =
      connection.publicConfiguration &&
      typeof connection.publicConfiguration === 'object' &&
      !Array.isArray(connection.publicConfiguration)
        ? (connection.publicConfiguration as Record<string, unknown>)
        : null;
    if (!raw) {
      throw new ServiceUnavailableException(
        'OAuth App global sem publicConfiguration',
      );
    }

    const clientId =
      typeof raw.clientId === 'string' ? raw.clientId.trim() : '';
    if (!clientId || clientId.length > 512) {
      throw new ServiceUnavailableException('OAuth clientId global invalido');
    }

    const authorizationEndpoint = httpsUrl(
      raw.authorizationEndpoint,
      'OAuth authorizationEndpoint',
    );
    const redirectUris = stringArray(raw.redirectUris, 'OAuth redirectUris').map(
      (value) => httpsUrl(value, 'OAuth redirectUri'),
    );

    const capabilityScopesRaw =
      raw.capabilityScopes &&
      typeof raw.capabilityScopes === 'object' &&
      !Array.isArray(raw.capabilityScopes)
        ? (raw.capabilityScopes as Record<string, unknown>)
        : null;
    if (!capabilityScopesRaw) {
      throw new ServiceUnavailableException(
        'OAuth capabilityScopes global nao configurado',
      );
    }
    const capabilityScopes: Record<string, string[]> = {};
    for (const [capability, scopes] of Object.entries(capabilityScopesRaw)) {
      const normalized = assertCapability(capability);
      capabilityScopes[normalized] = stringArray(
        scopes,
        'OAuth scopes de ' + normalized,
      );
    }

    const pkceMode =
      raw.pkceMode === 'S256' || raw.pkceMode === 'NONE'
        ? raw.pkceMode
        : null;
    if (!pkceMode) {
      throw new ServiceUnavailableException(
        'OAuth pkceMode deve ser S256 ou NONE',
      );
    }

    const authorizationParams: Record<string, string> = {};
    if (raw.authorizationParams !== undefined) {
      if (
        !raw.authorizationParams ||
        typeof raw.authorizationParams !== 'object' ||
        Array.isArray(raw.authorizationParams)
      ) {
        throw new ServiceUnavailableException(
          'OAuth authorizationParams invalido',
        );
      }
      for (const [key, value] of Object.entries(
        raw.authorizationParams as Record<string, unknown>,
      )) {
        if (RESERVED_AUTH_PARAMS.has(key)) {
          throw new ServiceUnavailableException(
            'OAuth authorizationParams tenta sobrescrever parametro reservado',
          );
        }
        if (
          !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ||
          typeof value !== 'string' ||
          value.length > 512
        ) {
          throw new ServiceUnavailableException(
            'OAuth authorizationParams contem entrada invalida',
          );
        }
        authorizationParams[key] = value;
      }
    }

    return {
      clientId,
      authorizationEndpoint,
      redirectUris,
      capabilityScopes,
      pkceMode,
      authorizationParams,
    };
  }

  private async assertTenantProviderAllowed(
    gymId: string,
    providerCode: string,
  ) {
    const provider = this.providers.require(providerCode);
    const featureKey = provider.tenantEntitlementFeatureKey;
    if (!featureKey) {
      throw new ForbiddenException(
        'Provider OAuth sem entitlement comercial tenant',
      );
    }
    const resolution = await this.entitlements.resolveFeature(gymId, featureKey);
    if (resolution.kind !== 'FEATURE' || resolution.value !== true) {
      throw new ForbiddenException(
        'Plano/configuracao do tenant nao autoriza OAuth deste provider',
      );
    }
    return provider;
  }

  private requestedCapabilities(
    requested: readonly string[] | undefined,
    providerCapabilities: readonly string[],
  ): string[] {
    const capabilities = [
      ...new Set((requested?.length ? requested : providerCapabilities).map(assertCapability)),
    ].sort();
    if (capabilities.length === 0) {
      throw new BadRequestException('OAuth exige ao menos uma capability');
    }
    for (const capability of capabilities) {
      if (!providerCapabilities.includes(capability)) {
        throw new BadRequestException(
          'Capability OAuth nao suportada pelo provider: ' + capability,
        );
      }
    }
    return capabilities;
  }

  private scopesForCapabilities(
    capabilities: readonly string[],
    configuration: OAuthAppConfiguration,
  ): string[] {
    const scopes = new Set<string>();
    for (const capability of capabilities) {
      const configured = configuration.capabilityScopes[capability];
      if (!configured?.length) {
        throw new ServiceUnavailableException(
          'OAuth App global sem scopes governados para ' + capability,
        );
      }
      configured.forEach((scope) => scopes.add(scope));
    }
    return [...scopes].sort();
  }

  async startTenantAuthorization(
    actor: TenantOAuthActor,
    providerCodeInput: string,
    dto: StartIntegrationOAuthDto,
  ) {
    if (!actor.userId || !actor.sessionId || !actor.gymId) {
      throw new UnauthorizedException('Sessao tenant OAuth invalida');
    }
    await this.authSecurity.assertStepUp(
      actor.userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );

    const providerCode = assertProviderCode(providerCodeInput);
    const provider = await this.assertTenantProviderAllowed(
      actor.gymId,
      providerCode,
    );
    if (!provider.supportsOAuth || !provider.authModels.includes('OAUTH2')) {
      throw new BadRequestException('Provider nao suporta OAuth2');
    }

    const environment =
      this.runtimeEnvironment.current() as IntegrationEnvironment;
    if (!provider.environments.includes(environment)) {
      throw new BadRequestException(
        'Provider OAuth nao habilitado no ambiente ativo',
      );
    }

    const appConnection = await this.prisma.integrationConnection.findFirst({
      where: {
        scope: IntegrationScope.GLOBAL,
        gymId: null,
        providerCode,
        environment,
        authModel: 'OAUTH2',
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
        OR: [
          { secretExpiresAt: null },
          { secretExpiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!appConnection) {
      throw new ServiceUnavailableException(
        'OAuth App global ativo nao configurado para ' + providerCode,
      );
    }

    const configuration = this.appConfiguration(appConnection);
    const requestedRedirect = httpsUrl(dto.redirectUri, 'OAuth redirectUri');
    if (!configuration.redirectUris.includes(requestedRedirect)) {
      throw new BadRequestException(
        'OAuth redirectUri fora da allowlist do App global',
      );
    }

    const capabilities = this.requestedCapabilities(
      dto.capabilities,
      provider.capabilities,
    );
    const scopes = this.scopesForCapabilities(capabilities, configuration);

    const state = randomBytes(OAUTH_STATE_BYTES).toString('base64url');
    const stateHash = sha256Hex(state);
    const expiresAt = new Date(Date.now() + OAUTH_ATTEMPT_TTL_MS);

    let pkceVerifier: string | null = null;
    let pkceReference: string | null = null;
    let pkceVersion: number | null = null;

    if (configuration.pkceMode === 'S256') {
      pkceVerifier = randomBytes(PKCE_VERIFIER_BYTES).toString('base64url');
      pkceReference = newIntegrationSecretReference();
      const physical = await this.vault.putSecret({
        reference: pkceReference,
        value: pkceVerifier,
      });
      pkceVersion = physical.version;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.integrationConnection.findMany({
          where: {
            scope: IntegrationScope.TENANT,
            gymId: actor.gymId,
            providerCode,
            environment,
            authModel: 'OAUTH2',
            status: { not: IntegrationConnectionStatus.DISCONNECTED },
          },
          orderBy: { updatedAt: 'desc' },
        });
        const connection =
          candidates.find((candidate) => {
            const stored = Array.isArray(candidate.capabilities)
              ? candidate.capabilities.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
            return sameStringSet(stored, capabilities);
          }) ??
          (await tx.integrationConnection.create({
            data: {
              scope: IntegrationScope.TENANT,
              gymId: actor.gymId,
              providerCode,
              environment,
              authModel: 'OAUTH2',
              status: IntegrationConnectionStatus.PENDING,
              capabilities,
              createdByUserId: actor.userId,
            },
          }));

        const attempt = await tx.integrationOAuthAuthorizationAttempt.create({
          data: {
            connectionId: connection.id,
            appConnectionId: appConnection.id,
            providerCode,
            environment,
            userId: actor.userId,
            sessionId: actor.sessionId,
            stateHash,
            redirectUri: requestedRedirect,
            capabilities,
            scopes,
            pkceMode: configuration.pkceMode,
            pkceSecretReference: pkceReference,
            pkceSecretVersion: pkceVersion,
            expiresAt,
          },
        });

        await this.audit.record(
          {
            gymId: actor.gymId,
            userId: actor.userId,
            action: 'INTEGRATION_OAUTH_AUTHORIZATION_STARTED',
            entity: 'IntegrationOAuthAuthorizationAttempt',
            entityId: attempt.id,
            next: {
              providerCode,
              connectionId: connection.id,
              environment,
              capabilities,
              scopeCount: scopes.length,
              pkceMode: configuration.pkceMode,
              expiresAt,
            },
          },
          tx,
        );

        return { connection, attempt };
      });

      const authorizationUrl = new URL(configuration.authorizationEndpoint);
      for (const [key, value] of Object.entries(
        configuration.authorizationParams,
      )) {
        authorizationUrl.searchParams.set(key, value);
      }
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('client_id', configuration.clientId);
      authorizationUrl.searchParams.set('redirect_uri', requestedRedirect);
      authorizationUrl.searchParams.set('scope', scopes.join(' '));
      authorizationUrl.searchParams.set('state', state);
      if (configuration.pkceMode === 'S256' && pkceVerifier) {
        authorizationUrl.searchParams.set(
          'code_challenge',
          base64UrlSha256(pkceVerifier),
        );
        authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      }

      return {
        providerCode,
        connectionId: result.connection.id,
        authorizationUrl: authorizationUrl.toString(),
        expiresAt,
        capabilities,
        pkceMode: configuration.pkceMode,
      };
    } catch (error) {
      if (pkceReference) {
        await this.vault.revokeSecret(pkceReference).catch(() => undefined);
      }
      throw error;
    }
  }

  async claimCallback(
    providerCodeInput: string,
    state: string,
    authorizationCode: string,
  ) {
    const providerCode = assertProviderCode(providerCodeInput);
    if (!state || state.length < 32 || state.length > 256) {
      throw new BadRequestException('OAuth state invalido');
    }
    if (!authorizationCode || authorizationCode.length > 4096) {
      throw new BadRequestException('OAuth authorization code invalido');
    }

    const stateHash = sha256Hex(state);
    const attempt =
      await this.prisma.integrationOAuthAuthorizationAttempt.findUnique({
        where: { stateHash },
        include: { connection: true },
      });
    const now = new Date();
    if (
      !attempt ||
      attempt.providerCode !== providerCode ||
      attempt.environment !== this.runtimeEnvironment.current() ||
      attempt.consumedAt ||
      attempt.expiresAt <= now
    ) {
      throw new UnauthorizedException('OAuth callback invalido ou expirado');
    }

    const [session, ownerRole, appConnection] = await Promise.all([
      this.prisma.session.findUnique({ where: { id: attempt.sessionId } }),
      this.prisma.userRole.findFirst({
        where: {
          userId: attempt.userId,
          gymId: attempt.connection.gymId,
          role: { name: 'OWNER' },
        },
        select: { id: true },
      }),
      this.prisma.integrationConnection.findFirst({
        where: {
          id: attempt.appConnectionId,
          scope: IntegrationScope.GLOBAL,
          gymId: null,
          providerCode,
          environment: attempt.environment,
          authModel: 'OAUTH2',
          status: IntegrationConnectionStatus.ACTIVE,
          secretReference: { not: null },
          secretVersion: { not: null },
          secretRevokedAt: null,
          OR: [
            { secretExpiresAt: null },
            { secretExpiresAt: { gt: now } },
          ],
        },
      }),
    ]);

    const absoluteExpiresAt = session
      ? session.absoluteExpiresAt ??
        new Date(session.createdAt.getTime() + REFRESH_SESSION_MAX_TTL_MS)
      : null;
    if (
      !session ||
      session.userId !== attempt.userId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !absoluteExpiresAt ||
      absoluteExpiresAt <= now ||
      !ownerRole ||
      !appConnection ||
      attempt.connection.scope !== IntegrationScope.TENANT ||
      !attempt.connection.gymId ||
      attempt.connection.providerCode !== providerCode ||
      attempt.connection.environment !== attempt.environment ||
      attempt.connection.status === IntegrationConnectionStatus.DISCONNECTED
    ) {
      throw new UnauthorizedException(
        'OAuth callback perdeu a autoridade da sessao/tenant de origem',
      );
    }

    const consumed = await this.prisma.integrationOAuthAuthorizationAttempt.updateMany({
      where: {
        id: attempt.id,
        stateHash,
        providerCode,
        environment: attempt.environment,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new ConflictException('OAuth state ja consumido ou expirado');
    }

    let pkceVerifier: IntegrationSecretValue | null = null;
    if (attempt.pkceMode === 'S256') {
      if (!attempt.pkceSecretReference || !attempt.pkceSecretVersion) {
        throw new ServiceUnavailableException(
          'OAuth PKCE metadata inconsistente',
        );
      }
      const physical = await this.vault.getSecret(
        attempt.pkceSecretReference,
      );
      if (physical.version !== attempt.pkceSecretVersion) {
        throw new ServiceUnavailableException(
          'OAuth PKCE version diverge do estado canonico',
        );
      }
      pkceVerifier = new IntegrationSecretValue(physical.value);
    }

    await this.audit.record({
      gymId: attempt.connection.gymId,
      userId: attempt.userId,
      action: 'INTEGRATION_OAUTH_CALLBACK_CLAIMED',
      entity: 'IntegrationOAuthAuthorizationAttempt',
      entityId: attempt.id,
      next: {
        providerCode,
        connectionId: attempt.connectionId,
        appConnectionId: attempt.appConnectionId,
        environment: attempt.environment,
        consumedAt: now,
      },
    });

    return {
      attemptId: attempt.id,
      providerCode,
      environment: attempt.environment,
      connectionId: attempt.connectionId,
      appConnectionId: attempt.appConnectionId,
      gymId: attempt.connection.gymId,
      userId: attempt.userId,
      sessionId: attempt.sessionId,
      redirectUri: attempt.redirectUri,
      capabilities: Array.isArray(attempt.capabilities)
        ? attempt.capabilities.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      scopes: Array.isArray(attempt.scopes)
        ? attempt.scopes.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      authorizationCode: new IntegrationSecretValue(authorizationCode),
      pkceVerifier,
      pkceSecretReference: attempt.pkceSecretReference,
    };
  }
}
