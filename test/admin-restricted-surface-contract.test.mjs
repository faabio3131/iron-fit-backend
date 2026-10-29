import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function source(path) {
  return fs.readFileSync(path, 'utf8');
}

test('finance remains owner/admin only and class-wide step-up protected', () => {
  const text = source('src/modules/financial/financial.controller.ts');
  assert.match(text, /@Controller\('financial'\)[\s\S]*?@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.doesNotMatch(text, /@Roles\([^)]*MANAGER/);
  assert.doesNotMatch(text, /@Roles\([^)]*RECEPTION/);
  assert.match(text, /@Roles\('SUPER_ADMIN', 'OWNER'\)/);
});

test('IRON billing is FM Command read-only and class-wide OWNER step-up guarded', () => {
  const text = source('src/modules/saas-billing/saas-billing.controller.ts');
  assert.match(text, /@Controller\('saas-billing'\)[\s\S]*?@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(text, /@Roles\('SUPER_ADMIN', 'OWNER'\)/);
  assert.match(text, /billingAuthority:\s*'FM_COMMAND'/);
  assert.match(text, /localMutationsEnabled:\s*false/);
  assert.match(text, /providerWebhooksAccepted:\s*false/);
  assert.match(text, /@Get\('authority'\)/);
  assert.match(text, /@Get\('prices'\)/);
  assert.match(text, /@Get\('current'\)/);
  assert.doesNotMatch(text, /@Post\(|@Put\(|@Patch\(|@Delete\(/);
});

test('tenant configuration administration is owner/admin and step-up protected', () => {
  const text = source('src/modules/product-entitlements/tenant-product-entitlements.controller.ts');
  for (const verb of ['Get', 'Put', 'Delete']) {
    assert.match(text, new RegExp(`@${verb}\\('tenant/configurations[^']*'\\)[\\s\\S]*?@UseGuards\\(StepUpGuard\\)[\\s\\S]*?@Roles\\('SUPER_ADMIN', 'OWNER'\\)`));
  }
});

test('integration provider and credential administration require step-up', () => {
  const connections = source('src/modules/integrations/integration-credential-tenant.controller.ts');
  const providers = source('src/modules/integrations/integration-provider-catalog.controller.ts');
  assert.match(connections, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(connections, /@Roles\('SUPER_ADMIN', 'OWNER'\)/);
  assert.match(providers, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(providers, /@Roles\('OWNER', 'SUPER_ADMIN'\)/);
});

test('financial dashboard drill-down requires active step-up', () => {
  const text = source('src/modules/dashboard/dashboard.controller.ts');
  assert.match(text, /@Get\('revenue'\)[\s\S]*?@UseGuards\(StepUpGuard\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER'\)/);
  assert.match(text, /@Get\('overdue'\)[\s\S]*?@UseGuards\(StepUpGuard\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER'\)/);
});
