import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const REFRESH_SESSION_PREFIX = 'AUTH_REFRESH|';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_SESSION_MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_LOGIN_FAILURES = 5;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

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
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newRefreshSecret(): string {
  return randomBytes(48).toString('base64url');
}

export function newActionSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function newRecoveryCode(): string {
  return randomBytes(10).toString('base64url').toUpperCase();
}

export function refreshSessionName(activeGymId: string | null): string {
  return `${REFRESH_SESSION_PREFIX}${activeGymId ?? 'GLOBAL'}`;
}

export function gymIdFromRefreshSessionName(deviceName?: string | null): string | null {
  if (!deviceName?.startsWith(REFRESH_SESSION_PREFIX)) return null;
  const value = deviceName.slice(REFRESH_SESSION_PREFIX.length);
  return value === 'GLOBAL' ? null : value;
}

export function loginIdentityHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export function securityKeyHash(scope: string, value: string): string {
  return createHash('sha256')
    .update(`${scope}:${value.trim().toLowerCase()}`)
    .digest('hex');
}

export function passwordPolicyViolations(password: string): string[] {
  const violations: string[] = [];
  if (password.length < 12) violations.push('MIN_LENGTH');
  if (password.length > 128) violations.push('MAX_LENGTH');
  if (!/[a-z]/.test(password)) violations.push('LOWERCASE');
  if (!/[A-Z]/.test(password)) violations.push('UPPERCASE');
  if (!/[0-9]/.test(password)) violations.push('NUMBER');
  if (!/[^A-Za-z0-9]/.test(password)) violations.push('SYMBOL');
  return violations;
}

function keyFromConfig(configService: ConfigService, name: string): Buffer {
  const raw = configService.get<string>(name)?.trim();
  if (!raw) throw new Error(`${name} obrigatoria`);
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} deve representar exatamente 32 bytes`);
  }
  return key;
}

function encryptionKey(configService: ConfigService): Buffer {
  return keyFromConfig(configService, 'MFA_ENCRYPTION_KEY');
}

export function encryptMfaSecret(configService: ConfigService, plaintext: string): string {
  const key = encryptionKey(configService);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptMfaSecret(configService: ConfigService, encrypted: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = encrypted.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Segredo MFA cifrado invalido');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(configService),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(input: Buffer): string {
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Segredo TOTP invalido');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, at = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(value % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function verifyTotp(secret: string, supplied: string, at = new Date()): boolean {
  if (!/^\d{6}$/.test(supplied)) return false;
  for (const drift of [-1, 0, 1]) {
    const candidate = totpCode(
      secret,
      new Date(at.getTime() + drift * TOTP_STEP_SECONDS * 1000),
    );
    const left = Buffer.from(candidate);
    const right = Buffer.from(supplied);
    if (left.length === right.length && timingSafeEqual(left, right)) return true;
  }
  return false;
}

export function totpUri(secret: string, email: string, issuer = 'IRON'): string {
  const label = encodeURIComponent(`${issuer}:${email.trim().toLowerCase()}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}


export function encryptActionSecret(
  configService: ConfigService,
  plaintext: string,
): string {
  const key = keyFromConfig(configService, 'AUTH_ACTION_TOKEN_ENCRYPTION_KEY');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptActionSecret(
  configService: ConfigService,
  encrypted: string,
): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = encrypted.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Token de acao cifrado invalido');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFromConfig(configService, 'AUTH_ACTION_TOKEN_ENCRYPTION_KEY'),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
