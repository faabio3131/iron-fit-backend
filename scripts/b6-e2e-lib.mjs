import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

export const BASE = process.env.B6_API_URL ?? 'http://127.0.0.1:3333/api/v1';
export const DAY = 24 * 60 * 60 * 1000;

export function log(event, extra = {}) {
  process.stdout.write(JSON.stringify({ event, ...extra }) + '\n');
}

export async function request(path, {
  method = 'GET',
  token,
  body,
  expected,
  headers = {},
} = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  const expectedStatuses = expected === undefined
    ? null
    : Array.isArray(expected) ? expected : [expected];
  const ok = expectedStatuses
    ? expectedStatuses.includes(response.status)
    : response.status >= 200 && response.status < 300;

  assert.ok(
    ok,
    `${method} ${path}: expected ${expected ?? '2xx'}, got ${response.status}: ${text.slice(0, 800)}`,
  );
  return { status: response.status, payload, headers: response.headers };
}

export async function login(email, password, extra = {}) {
  return (await request('/auth/login', {
    method: 'POST',
    expected: 200,
    body: { email, password, ...extra },
  })).payload;
}

export function plus(value, ms) {
  return new Date(new Date(value).getTime() + ms);
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

export async function billingWebhook(eventType, data, occurredAt = new Date()) {
  const secret = process.env.SAAS_BILLING_SANDBOX_SECRET;
  assert.ok(secret && secret.length >= 32, 'SAAS_BILLING_SANDBOX_SECRET missing');
  const payload = {
    eventId: crypto.randomUUID(),
    eventType,
    occurredAt: occurredAt.toISOString(),
    data,
  };
  const signature = createHmac('sha256', secret)
    .update(canonical(payload))
    .digest('hex');
  return request('/saas-billing/webhooks/INTERNAL_SANDBOX', {
    method: 'POST',
    expected: 201,
    headers: { 'x-saas-billing-signature': `sha256=${signature}` },
    body: payload,
  });
}
