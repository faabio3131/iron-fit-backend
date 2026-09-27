import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const SENSITIVE_KEY_NAMES = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'token',
  'refreshtoken',
  'refreshtokenhash',
  'accesstoken',
  'webhooksecret',
  'clientsecret',
  'apikey',
  'privatekey',
  'authorization',
  'cookie',
  'mfasecret',
  'mfacode',
  'recoverycode',
  'deliveryciphertext',
  'secretreference',
  'cvv',
  'cvc',
  'pan',
  'cardnumber',
  'pixqrcode',
]);

function normalizedSensitiveKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedSensitiveKey(key);
  if (SENSITIVE_KEY_NAMES.has(normalized)) return true;
  return (
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token') ||
    normalized.endsWith('privatekey') ||
    normalized === 'apikey'
  );
}

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

export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeAuditValue(nested);
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
          : (sanitizeAuditValue(input.previous) as Prisma.InputJsonValue),
        next: input.next === undefined
          ? Prisma.JsonNull
          : (sanitizeAuditValue(input.next) as Prisma.InputJsonValue),
        ipAddress: input.ipAddress ?? null,
        deviceInfo: input.deviceInfo ?? null,
      },
    });
  }
}
