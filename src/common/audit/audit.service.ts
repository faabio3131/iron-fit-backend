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
  'credentials',
  'secretValue',
  'secretReference',
  'apiKey',
  'accessToken',
  'clientSecret',
  'webhookSecret',
  'privateKey',
  'certificate',
  'authorizationCode',
  'cvv',
  'pan',
]);

const SENSITIVE_NORMALIZED_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'token',
  'refreshtoken',
  'refreshtokenhash',
  'authorization',
  'cookie',
  'mfasecret',
  'mfacode',
  'recoverycode',
  'deliveryciphertext',
  'apikeyenc',
  'accesstokenenc',
  'refreshtokenenc',
  'webhooksecretenc',
  'pixqrcode',
  'credentials',
  'secretvalue',
  'secretreference',
  'apikey',
  'accesstoken',
  'clientsecret',
  'webhooksecret',
  'privatekey',
  'certificate',
  'authorizationcode',
  'cvv',
  'pan',
  'cardnumber',
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

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_NORMALIZED_KEYS.has(normalized);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitize(nested);
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
