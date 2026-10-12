import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('FM Command control plane is isolated behind dedicated server-to-server authority', async () => {
  const controller = await source('src/modules/fm-command/fm-command-control-plane.controller.ts');
  const guard = await source('src/modules/fm-command/fm-command-control-plane.guard.ts');
  const service = await source('src/modules/fm-command/fm-command-control-plane.service.ts');
  assert.match(controller, /@Controller\('control-plane\/fmcc'\)/);
  assert.match(controller, /@UseGuards\(FmCommandControlPlaneGuard\)/);
  assert.match(guard, /FMCC_IRON_CONTROL_PLANE_TOKEN/);
  assert.match(guard, /timingSafeEqual/);
  assert.match(guard, /x-correlation-id/);
  assert.doesNotMatch(service, /passwordHash|mfaSecret|clientSecret|refreshToken/);
});

test('snapshot exposes IRON commercial facts while keeping billing authority in Command', async () => {
  const service = await source('src/modules/fm-command/fm-command-control-plane.service.ts');
  for (const value of [
    "schema_version: 'iron.fmcc.commercial.v1'",
    "product_code: 'IRON_FIT_CORE'",
    'billing_transactions: []',
    "billing_transactions: 'FM_COMMAND_AUTHORITY'",
    "fact_type: 'iron.tenant'",
    "fact_type: 'iron.trial'",
    "fact_type: 'iron.subscription'",
    "fact_type: 'iron.onboarding'",
  ]) assert.ok(service.includes(value), value);
  assert.doesNotMatch(service, /user\.email|passwordHash|mfaSecret/);
});

test('subscription commands have durable idempotency and reuse canonical plan lifecycle', async () => {
  const schema = await source('prisma/schema.prisma');
  const migration = await source('prisma/migrations/20261012041000_fm_command_control_plane/migration.sql');
  const service = await source('src/modules/fm-command/fm-command-control-plane.service.ts');
  assert.match(schema, /model FmCommandControlPlaneCommand/);
  assert.match(schema, /idempotencyKey\s+String\s+@unique/);
  assert.match(migration, /FmCommandControlPlaneCommand_idempotencyKey_key/);
  assert.match(service, /this\.lifecycle\.transition\(/);
  assert.match(service, /Idempotency-Key reutilizado com payload diferente/);
  assert.match(service, /status: 'PROCESSING'/);
  assert.match(service, /status: 'COMPLETED'/);
  assert.match(service, /status: 'FAILED'/);
});

test('gateway webhook is excluded from IRON while FM Command owns entitlement commands', async () => {
  const controller = await source('src/modules/saas-billing/saas-billing.controller.ts');
  const fmController = await source('src/modules/fm-command/fm-command-control-plane.controller.ts');
  assert.doesNotMatch(controller, /@Post\('webhooks\/:providerCode'\)/);
  assert.match(controller, /billingAuthority: 'FM_COMMAND'/);
  assert.match(fmController, /@Post\('subscription\/commands'\)/);
  assert.doesNotMatch(fmController, /providerCode|webhook/);
});
