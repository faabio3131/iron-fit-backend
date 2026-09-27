import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const {
  IntegrationSecretResolverService,
} = require('../dist/src/modules/integrations/secrets/integration-secret-resolver.service.js');
const {
  UnavailableIntegrationSecretVaultAdapter,
} = require('../dist/src/modules/integrations/secrets/unavailable-integration-secret-vault.adapter.js');

const prisma = new PrismaClient();
const id = '11111111-1111-4111-8111-000000000011';

try {
  const restored = await prisma.integrationConnection.findUnique({
    where: { id },
  });
  assert.ok(restored, 'C11 restored canonical connection metadata must exist');
  assert.match(restored.secretReference, /^isv_[A-Za-z0-9_-]{43}$/);

  const resolver = new IntegrationSecretResolverService(
    prisma,
    { current: () => 'HOMOLOG' },
    new UnavailableIntegrationSecretVaultAdapter(),
  );

  await assert.rejects(
    resolver.resolveForExternalBoundary(id, { scope: 'GLOBAL' }),
    /Vault fisico nao configurado/,
  );

  console.log(
    'C11_DR_RESTORE_PASS db_metadata_restored=true reusable_secret_reconstructed=false',
  );
} finally {
  await prisma.$disconnect();
}
