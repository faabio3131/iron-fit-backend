import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationEnvironment } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { UpsertFiscalScopeBindingDto } from './dto/upsert-fiscal-scope-binding.dto';

function externalScopeId(raw: string, field: string): string {
  const value = raw.trim();
  if (
    !value ||
    value.length > 128 ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new ConflictException(field + ' invalido');
  }
  return value;
}

@Injectable()
export class FiscalScopeBindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly authSecurity: AuthSecurityService,
    private readonly audit: AuditService,
  ) {}

  async upsert(
    gymId: string,
    userId: string,
    dto: UpsertFiscalScopeBindingDto,
  ) {
    await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
    const environment =
      this.runtime.current() as IntegrationEnvironment;
    const externalTenantId = externalScopeId(
      dto.externalTenantId,
      'Fiscal externalTenantId',
    );
    const externalUnitId = externalScopeId(
      dto.externalUnitId,
      'Fiscal externalUnitId',
    );

    const previous = await this.prisma.fiscalScopeBinding.findUnique({
      where: {
        gymId_environment: {
          gymId,
          environment,
        },
      },
    });

    const binding = await this.prisma.fiscalScopeBinding.upsert({
      where: {
        gymId_environment: {
          gymId,
          environment,
        },
      },
      create: {
        gymId,
        environment,
        externalTenantId,
        externalUnitId,
        active: true,
        createdByUserId: userId,
      },
      update: {
        externalTenantId,
        externalUnitId,
        active: true,
      },
    });

    await this.audit.record({
      gymId,
      userId,
      action: previous
        ? 'FISCAL_SCOPE_BINDING_UPDATED'
        : 'FISCAL_SCOPE_BINDING_CREATED',
      entity: 'FiscalScopeBinding',
      entityId: binding.id,
      previous: previous
        ? {
            externalTenantId: previous.externalTenantId,
            externalUnitId: previous.externalUnitId,
            active: previous.active,
          }
        : undefined,
      next: {
        environment,
        externalTenantId,
        externalUnitId,
        active: true,
      },
    });

    return {
      id: binding.id,
      gymId: binding.gymId,
      environment: binding.environment,
      externalTenantId: binding.externalTenantId,
      externalUnitId: binding.externalUnitId,
      active: binding.active,
      updatedAt: binding.updatedAt,
    };
  }

  async resolve(gymId: string) {
    const environment =
      this.runtime.current() as IntegrationEnvironment;
    const binding = await this.prisma.fiscalScopeBinding.findUnique({
      where: {
        gymId_environment: {
          gymId,
          environment,
        },
      },
    });
    if (!binding || !binding.active) {
      throw new NotFoundException(
        'Fiscal scope binding nao configurado para tenant/ambiente',
      );
    }
    return binding;
  }

  async getSafe(gymId: string) {
    const binding = await this.resolve(gymId);
    return {
      id: binding.id,
      gymId: binding.gymId,
      environment: binding.environment,
      externalTenantId: binding.externalTenantId,
      externalUnitId: binding.externalUnitId,
      active: binding.active,
      updatedAt: binding.updatedAt,
    };
  }
}
