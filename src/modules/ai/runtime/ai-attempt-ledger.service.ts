import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiExternalConfigurationContract, AiNormalizedRequest, AiNormalizedResponse } from '../contracts/ai-contract';

@Injectable()
export class AiAttemptLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(profileId: string, request: AiNormalizedRequest, config: Readonly<AiExternalConfigurationContract>, ordinal: number): Promise<string | null> {
    const inputHash = createHash('sha256').update(JSON.stringify({ input: request.input, prompt: request.prompt, capability: request.capability })).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const profile = await tx.aiConfigurationProfile.findUnique({ where: { id: profileId } });
          if (!profile || !profile.enabled || profile.status !== 'ACTIVE' || profile.capability !== request.capability
            || (profile.scope === 'TENANT' && profile.gymId !== request.context.tenantId)
            || profile.version !== config.version || profile.budgetUnits === null) return null;
          // Resolve latest again inside the serializable reservation; revocation/new versions cannot be bypassed.
          const latest = await tx.aiConfigurationProfile.findFirst({ where: {
            scope: profile.scope, gymId: profile.gymId, capability: profile.capability,
          }, orderBy: { version: 'desc' }, select: { id: true } });
          if (latest?.id !== profile.id) return null;
          if (profile.scope === 'GLOBAL' && await tx.aiConfigurationProfile.findFirst({ where: {
            scope: 'TENANT', gymId: request.context.tenantId, capability: request.capability,
          }, select: { id: true } })) return null;
          const spent = await tx.aiConfigurationProfile.updateMany({ where: {
            id: profileId, consumedUnits: { lt: profile.budgetUnits }, enabled: true, status: 'ACTIVE',
          }, data: { consumedUnits: { increment: 1 } } });
          if (spent.count !== 1) return null;
          const reservation = await tx.aiProviderAttempt.create({ data: {
            profileId, tenantId: request.context.tenantId, requestId: request.context.requestId, ordinal,
            inputHash, providerCode: config.providerCode, modelCode: config.modelCode,
            promptKey: request.prompt.promptKey, promptVersion: request.prompt.promptVersion,
          } });
          return reservation.id;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') return null; // Replay/concurrent request: no second billable attempt.
          if (error.code === 'P2034' && attempt < 2) continue;
        }
        throw error;
      }
    }
    return null;
  }

  async complete(id: string, result: AiNormalizedResponse, latencyMs: number, pricing?: AiExternalConfigurationContract['pricing']): Promise<void> {
    await this.prisma.aiProviderAttempt.update({ where: { id }, data: {
      status: result.status, failureCategory: result.failureCategory ?? null,
      inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
      latencyMs, completedAt: new Date(),
      // Missing usage or tariff is unknown, never zero; this is an estimate, not a provider invoice.
      estimatedCostNanoUsd: pricing && result.usage?.inputTokens !== undefined && result.usage?.outputTokens !== undefined
        ? BigInt(pricing.inputNanoUsdPerToken) * BigInt(result.usage.inputTokens) + BigInt(pricing.outputNanoUsdPerToken) * BigInt(result.usage.outputTokens)
        : null,
    } });
  }
}
