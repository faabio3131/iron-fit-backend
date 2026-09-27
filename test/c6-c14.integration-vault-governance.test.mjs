import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = (path) => fs.readFileSync(path, 'utf8');

test('C6 write-only admin API has secret mutation routes but no secret read route', () => {
  const controller = source('src/modules/integrations/integrations-admin.controller.ts');
  assert.match(controller, /@Put\('tenant\/connections\/:id\/secret'\)/);
  assert.match(controller, /@Delete\('tenant\/connections\/:id\/secret'\)/);
  assert.match(controller, /@Post\('tenant\/connections\/:id\/secret\/verify'\)/);
  assert.doesNotMatch(controller, /@Get\('tenant\/connections\/:id\/secret/);
  assert.doesNotMatch(controller, /reveal|plaintext|downloadSecret/i);
});

test('C7 critical mutations reuse canonical password plus MFA step-up', () => {
  const service = source('src/modules/integrations/integrations-admin.service.ts');
  assert.match(service, /security\.assertStepUp/);
  assert.match(service, /currentPassword/);
  assert.match(service, /mfaCode/);
  assert.match(service, /recoveryCode/);
});

test('C8 lifecycle records rotation expiry verification use and revocation', () => {
  const schema = source('prisma/integrations.prisma');
  const admin = source('src/modules/integrations/integrations-admin.service.ts');
  const resolver = source('src/modules/integrations/integration-secret-resolver.service.ts');
  for (const field of ['version','rotatedAt','expiresAt','lastUsedAt','lastVerifiedAt','revokedAt']) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(admin, /INTEGRATION_SECRET_ROTATED/);
  assert.match(admin, /INTEGRATION_SECRET_REVOKED/);
  assert.match(resolver, /lastVerifiedAt/);
  assert.match(resolver, /lastUsedAt/);
});

test('C9 audit sanitizer redacts integration secrets structurally', async () => {
  const { AuditService } = require('../dist/src/common/audit/audit.service.js');
  let captured;
  const prisma = {
    auditLog: {
      create: async ({ data }) => {
        captured = data;
        return data;
      },
    },
  };
  const audit = new AuditService(prisma);
  await audit.record({
    action: 'CERTIFY_REDACTION',
    entity: 'IntegrationConnection',
    next: {
      apiKey: 'do-not-log',
      access_token: 'do-not-log',
      nested: { client_secret: 'do-not-log', secretConfigured: true },
    },
  });
  assert.equal(captured.next.apiKey, '[REDACTED]');
  assert.equal(captured.next.access_token, '[REDACTED]');
  assert.equal(captured.next.nested.client_secret, '[REDACTED]');
  assert.equal(captured.next.nested.secretConfigured, true);
});

test('C10 environment isolation is server-side and DTOs never accept gymId', () => {
  const reference = source('src/modules/integrations/integration-secret-reference.service.ts');
  const admin = source('src/modules/integrations/integrations-admin.service.ts');
  assert.match(reference, /assertRuntimeEnvironment/);
  assert.match(admin, /assertEnvironment/);
  assert.doesNotMatch(source('src/modules/integrations/dto/integrations-admin.dto.ts'), /gymId/);
});

test('C11 DR contract keeps operational backup separate from external vault recovery', () => {
  const docs = source('docs/C6_C14_INTEGRATION_VAULT_GOVERNANCE.md');
  assert.match(docs, /backup do banco operacional/i);
  assert.match(docs, /nao restaura.*segredo/i);
  assert.match(docs, /OpenBao/i);
  assert.match(docs, /restore drill/i);
});

test('C12 forged tenant cannot select another tenant connection or reach vault', async () => {
  const { IntegrationsAdminService } = require(
    '../dist/src/modules/integrations/integrations-admin.service.js'
  );
  let vaultWrites = 0;
  const prisma = {
    integrationConnection: {
      findFirst: async ({ where }) => {
        if (where.id === 'connection-b' && where.gymId === 'tenant-b') {
          return {
            id: 'connection-b',
            scope: 'TENANT',
            gymId: 'tenant-b',
            providerCode: 'cert-provider',
            environment: 'DEV',
            status: 'PENDING',
            capabilities: [],
            publicConfiguration: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            secretVersions: [],
          };
        }
        return null;
      },
    },
  };
  const service = new IntegrationsAdminService(
    prisma,
    { record: async () => ({}) },
    { assertStepUp: async () => ({}) },
    { get: () => ({ providerCode: 'cert-provider', environments: ['DEV'], publicConfigurationKeys: [], secretKeys: ['apiKey'] }) },
    { assertRuntimeEnvironment: () => {}, newReferenceId: () => 'ref', path: () => 'path' },
    { resolveForVerification: async () => ({}) },
    { put: async () => { vaultWrites += 1; return { version: 1 }; }, get: async () => ({}), destroy: async () => {} },
  );
  await assert.rejects(() =>
    service.putTenantSecret(
      'connection-b',
      'tenant-a',
      'owner-a',
      { currentPassword: 'Strong-Pass-2026!', credentials: { apiKey: 'x' } },
    ),
  );
  assert.equal(vaultWrites, 0);
});

test('C12 controller derives tenant exclusively from authenticated context', () => {
  const controller = source('src/modules/integrations/integrations-admin.controller.ts');
  assert.match(controller, /user\.activeGymId \?\? user\.gymId/);
  assert.doesNotMatch(source('src/modules/integrations/dto/integrations-admin.dto.ts'), /gymId/);
});

test('C13 secret scanner is a permanent CI gate', () => {
  const workflow = source('.github/workflows/iron-s0-quality.yml');
  const scanner = source('scripts/secret-scan.mjs');
  assert.match(workflow, /Secret scanning gate/);
  assert.match(scanner, /Private key/);
  assert.match(scanner, /Mercado Pago credential/);
});

test('C14 break-glass is deny-by-default with no routine plaintext reveal endpoint', () => {
  const docs = source('docs/C6_C14_INTEGRATION_VAULT_GOVERNANCE.md');
  const controller = source('src/modules/integrations/integrations-admin.controller.ts');
  assert.match(docs, /break-glass/i);
  assert.match(docs, /rotate\/revoke/i);
  assert.match(docs, /TTL/i);
  assert.doesNotMatch(controller, /reveal|plaintext|downloadSecret/i);
});
