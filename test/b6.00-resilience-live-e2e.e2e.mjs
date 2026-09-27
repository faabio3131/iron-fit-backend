import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BASE, login, request } from '../scripts/b6-e2e-lib.mjs';

test('B6 live resilience: replay-safe signup, authenticated burst and spoofed provider rejection', async () => {
  const suffix = randomUUID().slice(0, 8);
  const requestId = randomUUID();
  const password = process.env.B6_OWNER_PASSWORD;
  assert.ok(password);

  const body = {
    requestId,
    email: `b6-resilience-${suffix}@example.com`,
    password,
    name: 'B6 Resilience Owner',
    gymName: `B6 Resilience Gym ${suffix}`,
    timezone: 'America/Sao_Paulo',
  };

  const first = await request('/commercial/trial/start', {
    method: 'POST',
    expected: 201,
    body,
  });
  assert.equal(first.payload.idempotentReplay, false);

  const replays = await Promise.all(
    Array.from({ length: 5 }, () =>
      request('/commercial/trial/start', {
        method: 'POST',
        expected: 201,
        body,
      }),
    ),
  );
  assert.ok(replays.every((item) => item.payload.idempotentReplay === true));

  const owner = await login(body.email, password);
  const startedAt = Date.now();
  const burst = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      request(
        index % 2 === 0
          ? '/product-entitlements/tenant/features'
          : '/auth/me',
        {
          token: owner.access_token,
          expected: 200,
        },
      ),
    ),
  );
  const elapsedMs = Date.now() - startedAt;
  assert.equal(burst.length, 30);
  assert.ok(
    elapsedMs < 20000,
    `authenticated burst exceeded proportional launch budget: ${elapsedMs}ms`,
  );

  const metrics = await fetch(BASE + '/health/metrics');
  assert.equal(metrics.status, 200);
  const metricsBody = await metrics.json();
  assert.ok(metricsBody.metrics.requestTotal >= 30);
  assert.equal(typeof metricsBody.metrics.error5xxTotal, 'number');

  const spoof = await request('/saas-billing/webhooks/INTERNAL_SANDBOX', {
    method: 'POST',
    expected: 401,
    headers: {
      'x-saas-billing-signature': 'sha256=' + '0'.repeat(64),
    },
    body: {
      eventId: randomUUID(),
      eventType: 'checkout.completed',
      occurredAt: new Date().toISOString(),
      data: { providerSessionRef: 'spoofed-provider-session' },
    },
  });
  assert.equal(spoof.status, 401);
}, { timeout: 45000 });
