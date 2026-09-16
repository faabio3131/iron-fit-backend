import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AiConfigurationScope as PrismaAiConfigurationScope,
  AiConfigurationStatus as PrismaAiConfigurationStatus,
  AiExecutionStatus as PrismaAiExecutionStatus,
  AiFailureCategory as PrismaAiFailureCategory,
  AiFallbackBehavior as PrismaAiFallbackBehavior,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AiExecutionProvenance,
  AiExternalConfigurationContract,
  defineAiExternalConfiguration,
} from './contracts/ai-contract';

const SERIALIZABLE_ATTEMPTS = 3;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface AiExecutionTraceInput extends AiExecutionProvenance {
  configurationProfileId?: string;
}

@Injectable()
export class AiPersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === SERIALIZABLE_ATTEMPTS) throw error;
      }
    }
    throw new ConflictException('Falha de concorrencia na persistencia AI0');
  }

  async createConfigurationProfile(
    configuration: AiExternalConfigurationContract,
    actorUserId: string | null = null,
  ) {
    const validated = defineAiExternalConfiguration(configuration);

    return this.serializable(async (tx) => {
      if (validated.scope === 'TENANT') {
        const gym = await tx.gym.findFirst({
          where: { id: validated.tenantId, active: true },
          select: { id: true },
        });
        if (!gym) throw new ForbiddenException('Tenant ativo nao encontrado');
      }

      const latest = await tx.aiConfigurationProfile.findFirst({
        where: {
          scope: validated.scope as PrismaAiConfigurationScope,
          gymId: validated.tenantId ?? null,
          capability: validated.capability,
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const expectedVersion = (latest?.version ?? 0) + 1;
      if (validated.version !== expectedVersion) {
        throw new ConflictException(
          `Versao de configuracao invalida; esperado ${expectedVersion}`,
        );
      }

      const profile = await tx.aiConfigurationProfile.create({
        data: {
          scope: validated.scope as PrismaAiConfigurationScope,
          gymId: validated.tenantId ?? null,
          capability: validated.capability,
          providerCode: validated.providerCode,
          modelCode: validated.modelCode,
          endpoint: validated.endpoint ?? null,
          region: validated.region ?? null,
          timeoutMs: validated.timeoutMs,
          budgetUnits: validated.budgetUnits ?? null,
          enabled: validated.enabled,
          fallbackBehavior: validated.fallbackBehavior as PrismaAiFallbackBehavior,
          secretReference: validated.secretReference ?? null,
          status: validated.status as PrismaAiConfigurationStatus,
          version: validated.version,
          createdByUserId: actorUserId,
        },
      });

      await this.audit.record(
        {
          gymId: profile.gymId,
          userId: actorUserId,
          action: 'AI_CONFIGURATION_PROFILE_CREATED',
          entity: 'AiConfigurationProfile',
          entityId: profile.id,
          next: {
            scope: profile.scope,
            capability: profile.capability,
            providerCode: profile.providerCode,
            modelCode: profile.modelCode,
            timeoutMs: profile.timeoutMs,
            budgetUnits: profile.budgetUnits,
            enabled: profile.enabled,
            fallbackBehavior: profile.fallbackBehavior,
            status: profile.status,
            version: profile.version,
            secretReferenceConfigured: Boolean(profile.secretReference),
          },
        },
        tx,
      );

      return profile;
    });
  }

  async recordExecution(input: AiExecutionTraceInput) {
    this.assertExecutionInput(input);

    return this.serializable(async (tx) => {
      const existing = await tx.aiExecutionTrace.findUnique({
        where: { requestId: input.requestId },
      });
      if (existing) {
        const sameFact =
          existing.gymId === input.tenantId &&
          existing.capability === input.capability &&
          existing.inputHash === input.inputHash;
        if (!sameFact) {
          throw new ConflictException('requestId ja vinculado a outra execucao de IA');
        }
        return existing;
      }

      if (input.configurationProfileId) {
        const profile = await tx.aiConfigurationProfile.findUnique({
          where: { id: input.configurationProfileId },
        });
        if (!profile) throw new ConflictException('Perfil de configuracao nao encontrado');
        const scopeMatches =
          profile.scope === (input.configurationScope as PrismaAiConfigurationScope) &&
          (profile.scope === PrismaAiConfigurationScope.GLOBAL || profile.gymId === input.tenantId);
        const provenanceMatches =
          profile.capability === input.capability &&
          profile.providerCode === input.providerCode &&
          profile.modelCode === input.modelCode &&
          profile.version === input.configurationVersion;
        if (!scopeMatches || !provenanceMatches) {
          throw new ConflictException('Perfil de configuracao nao corresponde a proveniencia');
        }
      }

      const trace = await tx.aiExecutionTrace.create({
        data: {
          gymId: input.tenantId,
          actorId: input.actorId ?? null,
          studentId: input.studentId ?? null,
          capability: input.capability,
          providerCode: input.providerCode,
          modelCode: input.modelCode,
          promptKey: input.promptKey,
          promptVersion: input.promptVersion,
          configurationProfileId: input.configurationProfileId ?? null,
          configurationVersion: input.configurationVersion,
          inputHash: input.inputHash,
          outputHash: input.outputHash ?? null,
          confidence: input.confidence ?? null,
          flags: input.flags.length > 0
            ? (Array.from(input.flags) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          status: input.status as PrismaAiExecutionStatus,
          failureCategory: input.failureCategory
            ? (input.failureCategory as PrismaAiFailureCategory)
            : null,
          latencyMs: input.latencyMs,
          requestId: input.requestId,
        },
      });

      await this.audit.record(
        {
          gymId: input.tenantId,
          userId: input.actorId ?? null,
          action: 'AI_EXECUTION_TRACED',
          entity: 'AiExecutionTrace',
          entityId: trace.id,
          next: {
            capability: input.capability,
            providerCode: input.providerCode,
            modelCode: input.modelCode,
            promptKey: input.promptKey,
            promptVersion: input.promptVersion,
            configurationVersion: input.configurationVersion,
            inputHash: input.inputHash,
            outputHash: input.outputHash ?? null,
            confidence: input.confidence ?? null,
            flags: Array.from(input.flags),
            status: input.status,
            failureCategory: input.failureCategory ?? null,
            latencyMs: input.latencyMs,
            requestId: input.requestId,
          },
        },
        tx,
      );

      return trace;
    });
  }

  private assertExecutionInput(input: AiExecutionTraceInput) {
    if (!SHA256_PATTERN.test(input.inputHash)) {
      throw new ConflictException('inputHash deve ser SHA-256 hexadecimal');
    }
    if (input.outputHash && !SHA256_PATTERN.test(input.outputHash)) {
      throw new ConflictException('outputHash deve ser SHA-256 hexadecimal');
    }
    if (!Number.isInteger(input.latencyMs) || input.latencyMs < 0) {
      throw new ConflictException('latencyMs invalido');
    }
    if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
      throw new ConflictException('confidence fora do intervalo 0..1');
    }
  }
}
