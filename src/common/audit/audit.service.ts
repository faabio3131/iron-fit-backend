import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'refreshToken',
  'refreshTokenHash',
  'authorization',
  'cookie',
  'mfaSecret',
  'mfaCode',
  'recoveryCode',
  'deliveryCiphertext',
  'apiKeyEnc',
  'accessTokenEnc',
  'refreshTokenEnc',
  'webhookSecretEnc',
  'pixQrCode',
]);

type AuditDb = PrismaService | Prisma.TransactionClient | PrismaClient;

export interface AuditRecordInput {
  gymId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  previous?: unknown;
  next?: unknown;
  ipAddress?: string | null;
  deviceInfo?: string | null;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitize(nested);
      }
    }
    return output;
  }

  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput, db: AuditDb = this.prisma) {
    return db.auditLog.create({
      data: {
        gymId: input.gymId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        previous: input.previous === undefined
          ? Prisma.JsonNull
          : (sanitize(input.previous) as Prisma.InputJsonValue),
        next: input.next === undefined
          ? Prisma.JsonNull
          : (sanitize(input.next) as Prisma.InputJsonValue),
        ipAddress: input.ipAddress ?? null,
        deviceInfo: input.deviceInfo ?? null,
      },
    });
  }
}
