import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';
import {
  SaasBillingProviderContext,
  SaasBillingProviderPort,
} from './contracts/saas-billing-provider.port';
import { SaasBillingProviderRegistry } from './saas-billing-provider.registry';

const FM_BILLING_CAPABILITY = 'billing.saas.fm';

function hasCapability(raw: unknown, required: string): boolean {
  return (
    Array.isArray(raw) &&
    raw.some(
      (value) =>
        typeof value === 'string' &&
        value.trim().toLowerCase() === required,
    )
  );
}

export type ResolvedSaasBillingProvider = {
  code: string;
  adapter: SaasBillingProviderPort;
  context: SaasBillingProviderContext;
  connectionId: string | null;
  sandboxOnly: boolean;
};

@Injectable()
export class SaasBillingProviderConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly registry: SaasBillingProviderRegistry,
  ) {}

  private configuredProviderCode(): string | null {
    const value = this.config.get<string>('SAAS_BILLING_PROVIDER')?.trim();
    return value || null;
  }

  async resolve(
    expectedCode?: string,
  ): Promise<ResolvedSaasBillingProvider> {
    const configured = this.configuredProviderCode();
    if (configured?.toUpperCase() === 'INTERNAL_SANDBOX') {
      const adapter = this.registry.require('INTERNAL_SANDBOX');
      if (
        expectedCode &&
        expectedCode.toLowerCase() !== adapter.code.toLowerCase()
      ) {
        throw new BadRequestException(
          'Provider SaaS billing nao autorizado',
        );
      }
      adapter.assertAvailable();
      return {
        code: adapter.code,
        adapter,
        context: {
          connectionId: null,
          publicConfiguration: null,
          credential: null,
        },
        connectionId: null,
        sandboxOnly: true,
      };
    }

    const environment =
      this.runtime.current() as IntegrationEnvironment;
    const candidates = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.GLOBAL,
        gymId: null,
        environment,
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

    const capable = candidates.filter((connection) => {
      if (!hasCapability(connection.capabilities, FM_BILLING_CAPABILITY)) {
        return false;
      }
      if (
        configured &&
        connection.providerCode.toLowerCase() !== configured.toLowerCase()
      ) {
        return false;
      }
      return true;
    });

    if (capable.length !== 1) {
      throw new ServiceUnavailableException(
        capable.length === 0
          ? 'Provider SaaS billing GLOBAL nao configurado/homologado'
          : 'Provider SaaS billing GLOBAL ambiguo',
      );
    }

    const connection = capable[0];
    if (
      expectedCode &&
      expectedCode.toLowerCase() !== connection.providerCode.toLowerCase()
    ) {
      throw new BadRequestException(
        'Provider SaaS billing nao autorizado',
      );
    }

    const adapter = this.registry.require(connection.providerCode);
    const credential = await this.secrets.resolveForExternalBoundary(
      connection.id,
      { scope: 'GLOBAL' },
    );
    const context: SaasBillingProviderContext = {
      connectionId: connection.id,
      publicConfiguration: connection.publicConfiguration,
      credential,
    };
    adapter.assertAvailable(context);

    return {
      code: connection.providerCode,
      adapter,
      context,
      connectionId: connection.id,
      sandboxOnly: false,
    };
  }
}
