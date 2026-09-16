import { Injectable } from '@nestjs/common';

const BLOCKED_KEY_PATTERN = /(access.?token|refresh.?token|authorization|password|senha|passcode|api.?key|secret|cookie|jwt|bank|account.?number|card.?number|credit|debit|cvv|cvc|pix|billing|charge|financial|fiscal|tax|credential)/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const INLINE_SECRET_PATTERN = /\b(password|senha|token|api[_ -]?key|secret|cvv|cvc|pix[_ -]?key)\s*[:=]\s*[^\s,;]+/gi;
const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 2000;

@Injectable()
export class AiSanitizerService {
  sanitize<T = unknown>(input: T): unknown {
    return this.sanitizeValue(input, 0);
  }

  private sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return this.sanitizeString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY).map((item) => this.sanitizeValue(item, depth + 1));
    }
    if (typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (BLOCKED_KEY_PATTERN.test(key)) continue;
        output[key] = this.sanitizeValue(nested, depth + 1);
      }
      return output;
    }
    return String(value).slice(0, MAX_STRING);
  }

  private sanitizeString(value: string) {
    return value
      .slice(0, MAX_STRING)
      .replace(BEARER_PATTERN, '[REDACTED]')
      .replace(JWT_PATTERN, '[REDACTED]')
      .replace(INLINE_SECRET_PATTERN, '$1=[REDACTED]')
      .replace(CARD_PATTERN, '[REDACTED]');
  }
}
