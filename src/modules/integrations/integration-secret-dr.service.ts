import {
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import {
  IntegrationDrAssessDto,
  IntegrationDrReconcileDto,
} from './dto/integration-dr.dto';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

export type IntegrationDrOutcome =
  | 'AVAILABLE'
  | 'METADATA_INCOMPLETE'
  | 'VERSION_MISMATCH'
  | 'EXPIRED'
  | 'VAULT_UNAVAILABLE';

export interface IntegrationDrItem {
  connectionId: string;
  scope: string;
  gymId: string | null;
  providerCode: string;
  status: string;
  outcome: IntegrationDrOutcome;
  expectedVersion: number | null;
  observedVersion: number | null;
}

type Assessment = {
  environment: IntegrationEnvironment;
  assessedAt: Date;
  items: IntegrationDrItem[];
};

@Injectable()
export class IntegrationSecretDrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSecurity: AuthSecurityService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private async stepUp(
    userId: string,
    dto: IntegrationDrAssessDto | IntegrationDrReconcileDto,
  ) {
    await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  private async assessInternal(): Promise<Assessment> {
    const environment = this.runtime.current() as IntegrationEnvironment;
    const rows = await this.prisma.integrationConnection.findMany({
      where: {
        environment,
        secretRevokedAt: null,
        status: {
          in: [
            IntegrationConnectionStatus.ACTIVE,
            IntegrationConnectionStatus.DEGRADED,
            IntegrationConnectionStatus.SUSPENDED,
          ],
        },
      },
      orderBy: [{ providerCode: 'asc' }, { id: 'asc' }],
    });

    const now = new Date();
    const items: IntegrationDrItem[] = [];

    for (const row of rows) {
      let outcome: IntegrationDrOutcome = 'AVAILABLE';
      let observedVersion: number | null = null;

      if (
        !row.secretReference
        || !row.secretVersion
        || !row.secretRotatedAt
      ) {
        outcome = 'METADATA_INCOMPLETE';
      } else if (row.secretExpiresAt && row.secretExpiresAt <= now) {
        outcome = 'EXPIRED';
      } else {
        try {
          const physical = await this.vault.inspectSecret(row.secretReference);
          observedVersion = physical.version;

          if (physical.version !== row.secretVersion) {
            outcome = 'VERSION_MISMATCH';
          } else if (physical.expiresAt && physical.expiresAt <= now) {
            outcome = 'EXPIRED';
          }
        } catch {
          outcome = 'VAULT_UNAVAILABLE';
        }
      }

      items.push({
        connectionId: row.id,
        scope: row.scope,
        gymId: row.gymId ?? null,
        providerCode: row.providerCode,
        status: row.status,
        outcome,
        expectedVersion: row.secretVersion ?? null,
        observedVersion,
      });
    }

    return {
      environment,
      assessedAt: now,
      items,
    };
  }

  private summary(assessment: Assessment) {
    const counts = {
      AVAILABLE: 0,
      METADATA_INCOMPLETE: 0,
      VERSION_MISMATCH: 0,
      EXPIRED: 0,
      VAULT_UNAVAILABLE: 0,
    } satisfies Record<IntegrationDrOutcome, number>;

    for (const item of assessment.items) counts[item.outcome] += 1;

    return {
      environment: assessment.environment,
      assessedAt: assessment.assessedAt,
      total: assessment.items.length,
      counts,
      items: assessment.items,
    };
  }

  async assess(userId: string, dto: IntegrationDrAssessDto) {
    await this.stepUp(userId, dto);
    const assessment = await this.assessInternal();

    await this.audit.record({
      userId,
      action: 'INTEGRATION_DR_ASSESSED',
      entity: 'IntegrationSecretDisasterRecovery',
      next: {
        environment: assessment.environment,
        total: assessment.items.length,
        unavailable: assessment.items.filter(
          (item) => item.outcome !== 'AVAILABLE',
        ).length,
      },
    });

    return this.summary(assessment);
  }

  async reconcileFailClosed(
    userId: string,
    dto: IntegrationDrReconcileDto,
  ) {
    await this.stepUp(userId, dto);
    const assessment = await this.assessInternal();

    const unsafe = assessment.items.filter(
      (item) => item.outcome !== 'AVAILABLE',
    );
    let changed = 0;

    for (const item of unsafe) {
      const result = await this.prisma.integrationConnection.updateMany({
        where: {
          id: item.connectionId,
          environment: assessment.environment,
          secretRevokedAt: null,
          status: IntegrationConnectionStatus.ACTIVE,
        },
        data: {
          status: IntegrationConnectionStatus.DEGRADED,
          lastVerifiedAt: null,
        },
      });
      changed += result.count;
    }

    await this.audit.record({
      userId,
      action: 'INTEGRATION_DR_FAIL_CLOSED_RECONCILED',
      entity: 'IntegrationSecretDisasterRecovery',
      next: {
        environment: assessment.environment,
        assessed: assessment.items.length,
        unsafe: unsafe.length,
        changedToDegraded: changed,
        confirmation: dto.confirmation,
      },
    });

    return {
      ...this.summary(assessment),
      changedToDegraded: changed,
      recoveryRule:
        'DB restore never reconstructs secret values; provider verification is required before any DEGRADED connection may become ACTIVE again.',
    };
  }
}
