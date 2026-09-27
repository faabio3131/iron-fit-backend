import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

test('C6 provider catalog returns only safe descriptor metadata and active environment', () => {
  const { IntegrationProviderCatalogController } = require(
    '../dist/src/modules/integrations/integration-provider-catalog.controller.js',
  );
  const controller = new IntegrationProviderCatalogController(
    {
      list: () => [{
        providerCode: 'example',
        capabilities: ['payments.charge'],
        authModels: ['API_KEY'],
        environments: ['HOMOLOG'],
        supportsWebhook: true,
        supportsOAuth: false,
      }],
    },
    { current: () => 'HOMOLOG' },
  );
  const result = controller.list();
  assert.equal(result.environment, 'HOMOLOG');
  assert.deepEqual(result.providers, [{
    providerCode: 'example',
    capabilities: ['payments.charge'],
    authModels: ['API_KEY'],
    environments: ['HOMOLOG'],
    supportsWebhook: true,
    supportsOAuth: false,
  }]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('gymId'), false);
});

test('C6 provider catalog is authenticated and contains no secret/Vault fields', async () => {
  const source = await readFile(
    'src/modules/integrations/integration-provider-catalog.controller.ts',
    'utf8',
  );
  assert.match(source, /JwtAuthGuard/);
  assert.match(source, /RolesGuard/);
  assert.match(source, /@Roles\('OWNER', 'SUPER_ADMIN'\)/);
  assert.doesNotMatch(source, /secretReference|vaultId|keyId|token|password/i);
});
