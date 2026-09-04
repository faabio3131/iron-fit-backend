import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

test('AGG2 API derives tenant from authenticated context and never accepts gymId in DTOs', async () => {
  const controller = await source('src/modules/aggregator/agreements/aggregator-agreements.controller.ts');
  const createDto = await source('src/modules/aggregator/agreements/dto/create-aggregator-agreement.dto.ts');
  const signDto = await source('src/modules/aggregator/agreements/dto/sign-aggregator-agreement.dto.ts');
  const revokeDto = await source('src/modules/aggregator/agreements/dto/revoke-aggregator-agreement.dto.ts');

  assert.equal(controller.includes('user.activeGymId ?? user.gymId'), true);
  assert.equal(createDto.includes('gymId'), false);
  assert.equal(signDto.includes('gymId'), false);
  assert.equal(revokeDto.includes('gymId'), false);
});

test('AGG2 agreement writes are tenant scoped, serializable and atomically audited', async () => {
  const service = await source('src/modules/aggregator/agreements/aggregator-agreements.service.ts');

  assert.equal(service.includes('connection: { gymId: tenantId }'), true);
  assert.equal(service.includes('member: { connection: { gymId: tenantId } }'), true);
  assert.equal(service.includes('Prisma.TransactionIsolationLevel.Serializable'), true);
  assert.equal(service.includes("error.code === 'P2034' || error.code === 'P2002'"), true);
  assert.equal(service.includes("action: 'AGGREGATOR_AGREEMENT_REGISTERED'"), true);
  assert.equal(service.includes("action: 'AGGREGATOR_AGREEMENT_SIGNED'"), true);
  assert.equal(service.includes("action: 'AGGREGATOR_AGREEMENT_REVOKED'"), true);
  assert.equal(service.includes('},\n            tx,'), true);
});

test('AGG2 signing binds acceptance to exact document and evidence hashes', async () => {
  const dto = await source('src/modules/aggregator/agreements/dto/sign-aggregator-agreement.dto.ts');
  const service = await source('src/modules/aggregator/agreements/aggregator-agreements.service.ts');

  assert.equal(dto.includes('@Equals(true)'), true);
  assert.equal(dto.includes('documentHash'), true);
  assert.equal(dto.includes('acceptanceEvidenceHash'), true);
  assert.equal(dto.includes("'ELECTRONIC_ACCEPTANCE'"), true);
  assert.equal(service.includes('agreement.documentHash !== documentHash'), true);
  assert.equal(service.includes('evidenceHash'), true);
  assert.equal(service.includes('signerMemberId'), true);
});

test('AGG2 never turns a signed agreement into visit authorization or physical access', async () => {
  const service = await source('src/modules/aggregator/agreements/aggregator-agreements.service.ts');
  const docs = await source('docs/AGG2_DIGITAL_AGREEMENT_VAULT.md');

  assert.equal(service.includes('aggregatorVisitAuthorization'), false);
  assert.equal(service.includes('accessEvent.create'), false);
  assert.equal(docs.includes('acordo nunca é autorização de visita por si só'), true);
  assert.equal(docs.includes('AGG2 não:'), true);
});

test('AGG2 register fails closed for a member outside the active tenant', async () => {
  const { AggregatorAgreementsService } = require('../dist/src/modules/aggregator/agreements/aggregator-agreements.service.js');
  let audited = false;
  const tx = {
    aggregatorMember: {
      findFirst: async () => null,
    },
  };
  const prisma = {
    $transaction: async (operation) => operation(tx),
  };
  const audit = {
    record: async () => {
      audited = true;
    },
  };
  const service = new AggregatorAgreementsService(prisma, audit);

  await assert.rejects(
    () => service.register({
      memberId: '11111111-1111-4111-8111-111111111111',
      version: 'v1',
      documentHash: 'a'.repeat(64),
    }, 'gym-a', 'user-a'),
    (error) => {
      assert.equal(error.getStatus(), 404);
      return true;
    },
  );
  assert.equal(audited, false);
});

test('AGG2 sign rejects a document hash mismatch before mutation or audit', async () => {
  const { AggregatorAgreementsService } = require('../dist/src/modules/aggregator/agreements/aggregator-agreements.service.js');
  let updated = false;
  let audited = false;
  const tx = {
    aggregatorAgreement: {
      findFirst: async () => ({
        id: 'agreement-1',
        memberId: 'member-1',
        documentHash: 'a'.repeat(64),
        status: 'REQUIRED',
        provenance: null,
        signedAt: null,
        revokedAt: null,
        member: { id: 'member-1' },
      }),
      update: async () => {
        updated = true;
      },
    },
  };
  const prisma = {
    $transaction: async (operation) => operation(tx),
  };
  const audit = {
    record: async () => {
      audited = true;
    },
  };
  const service = new AggregatorAgreementsService(prisma, audit);

  await assert.rejects(
    () => service.sign('agreement-1', {
      accepted: true,
      documentHash: 'b'.repeat(64),
      acceptanceEvidenceHash: 'c'.repeat(64),
      method: 'ELECTRONIC_ACCEPTANCE',
    }, 'gym-a', 'user-a'),
    (error) => {
      assert.equal(error.getStatus(), 409);
      return true;
    },
  );
  assert.equal(updated, false);
  assert.equal(audited, false);
});

test('AGG2 same version and same hash is idempotent and does not create duplicate history', async () => {
  const { AggregatorAgreementsService } = require('../dist/src/modules/aggregator/agreements/aggregator-agreements.service.js');
  let created = false;
  let audited = false;
  const existing = {
    id: 'agreement-1',
    memberId: 'member-1',
    version: 'v1',
    status: 'REQUIRED',
    documentHash: 'a'.repeat(64),
  };
  const tx = {
    aggregatorMember: {
      findFirst: async () => ({ id: 'member-1', connectionId: 'connection-1' }),
    },
    aggregatorAgreement: {
      findUnique: async () => existing,
      create: async () => {
        created = true;
      },
    },
  };
  const prisma = {
    $transaction: async (operation) => operation(tx),
  };
  const audit = {
    record: async () => {
      audited = true;
    },
  };
  const service = new AggregatorAgreementsService(prisma, audit);

  const result = await service.register({
    memberId: '11111111-1111-4111-8111-111111111111',
    version: 'v1',
    documentHash: 'A'.repeat(64),
  }, 'gym-a', 'user-a');

  assert.equal(result.id, 'agreement-1');
  assert.equal(created, false);
  assert.equal(audited, false);
});
