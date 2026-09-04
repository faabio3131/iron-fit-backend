import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const REFRESH_SESSION_PREFIX = 'AUTH_REFRESH|';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_LOGIN_FAILURES = 5;

export function requireJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET obrigatorio e deve possuir ao menos 32 caracteres');
  }
  return secret;
}

export function hashOpaqueToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function opaqueHashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newRefreshSecret(): string {
  return randomBytes(48).toString('base64url');
}

export function refreshSessionName(activeGymId: string | null): string {
  return `${REFRESH_SESSION_PREFIX}${activeGymId ?? 'GLOBAL'}`;
}

export function gymIdFromRefreshSessionName(deviceName?: string | null): string | null {
  if (!deviceName?.startsWith(REFRESH_SESSION_PREFIX)) {
    return null;
  }
  const value = deviceName.slice(REFRESH_SESSION_PREFIX.length);
  return value === 'GLOBAL' ? null : value;
}

export function loginIdentityHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
