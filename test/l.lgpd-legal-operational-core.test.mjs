import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  PrivacyGovernanceService,
} = require(
  '../dist/src/modules/privacy/privacy-governance.service.js',
);

function fixture() {
  const audit = [];
  const dsr = [];
  const acceptances = [];
  const documents = [
    {
      id: 'doc-privacy-v1',
      kind: 'PRIVACY_POLICY',
      version: '1',
      status: 'APPROVED',
      contentUrl: 'https://example.invalid/privacy-v1',
      contentHash: 'a'.repeat(64),
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      approvedAt: new Date('2026-08-31T00:00:00.000Z'),
    },
    {
      id: 'doc-terms-draft',
      kind: 'TERMS_OF_SERVICE',
      version: '1',
      status: 'DRAFT',
      contentUrl: 'https://example.invalid/terms-v1',
      contentHash: 'b'.repeat(64),
      effectiveAt: null,
      approvedAt: null,
    },
  ];

  const prisma = {
    dataSubjectRequest: {
      findFirst: async ({ where }) =>
        dsr.find(
          (row) =>
            row.userId === where.userId &&
            (!where.type || row.type === where.type) &&
            (!where.id || row.id === where.id) &&
            (!where.status?.in || where.status.in.includes(row.status)),
        ) ?? null,
      findMany: async ({ where } = {}) =>
        where?.userId
          ? dsr.filter((row) => row.userId === where.userId)
          : [...dsr],
      findUnique: async ({ where }) =>
        dsr.find((row) => row.id === where.id) ?? null,
      create: async ({ data }) => {
        const row = {
          id: 'dsr-' + (dsr.length + 1),
          status: 'OPEN',
          requestedAt: new Date(),
          operationalDueAt: null,
          reviewedAt: null,
          completedAt: null,
          resolutionCode: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        dsr.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = dsr.find((item) => item.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      count: async () =>
        dsr.filter(
          (row) =>
            row.status === 'OPEN' || row.status === 'IN_REVIEW',
        ).length,
    },
    legalDocument: {
      findFirst: async ({ where }) =>
        documents.find(
          (row) =>
            row.id === where.id &&
            row.status === 'APPROVED' &&
            row.approvedAt,
        ) ?? null,
      findMany: async ({ where } = {}) =>
        where?.status
          ? documents.filter((row) => row.status === where.status)
          : [...documents],
    },
    legalAcceptance: {
      upsert: async ({ where, create, include }) => {
        const existing = acceptances.find(
          (row) =>
            row.userId === where.userId_legalDocumentId.userId &&
            row.legalDocumentId ===
              where.userId_legalDocumentId.legalDocumentId,
        );
        if (existing) return existing;
        const document = documents.find(
          (row) => row.id === create.legalDocumentId,
        );
        const row = {
          id: 'acceptance-' + (acceptances.length + 1),
          ...create,
          acceptedAt: new Date(),
          legalDocument: include
            ? {
                kind: document.kind,
                version: document.version,
                contentHash: document.contentHash,
              }
            : undefined,
        };
        acceptances.push(row);
        return row;
      },
      findMany: async ({ where }) =>
        acceptances.filter((row) => row.userId === where.userId),
    },
    dataRetentionPolicy: {
      findMany: async () => [],
    },
    subprocessorRecord: {
      findMany: async () => [],
    },
  };

  const service = new PrivacyGovernanceService(prisma, {
    record: async (record) => {
      audit.push(record);
    },
  });

  return { service, dsr, acceptances, audit };
}

test('L2 creates one active DSR per type and audits workflow metadata', async () => {
  const fx = fixture();

  const created = await fx.service.createRequest('user-a', {
    type: 'ACCESS',
  });

  assert.equal(created.status, 'OPEN');
  assert.equal(created.userId, 'user-a');
  assert.equal(created.type, 'ACCESS');
  assert.equal(fx.audit[0].action, 'PRIVACY_DSR_CREATED');

  await assert.rejects(
    () =>
      fx.service.createRequest('user-a', {
        type: 'ACCESS',
      }),
    /Ja existe solicitacao LGPD ativa/,
  );
});

test('L3/L4 accepts only approved legal documents and records exact version/hash', async () => {
  const fx = fixture();

  const acceptance = await fx.service.acceptLegalDocument('user-a', {
    legalDocumentId: 'doc-privacy-v1',
  });

  assert.equal(acceptance.legalDocument.kind, 'PRIVACY_POLICY');
  assert.equal(acceptance.legalDocument.version, '1');
  assert.equal(acceptance.legalDocument.contentHash, 'a'.repeat(64));

  await assert.rejects(
    () =>
      fx.service.acceptLegalDocument('user-a', {
        legalDocumentId: 'doc-terms-draft',
      }),
    /nao esta aprovado\/vigente/,
  );
});

test('L gate fails closed when legal/retention/subprocessor registries are not approved', async () => {
  const fx = fixture();

  const snapshot = await fx.service.governanceSnapshot();

  assert.equal(snapshot.gate.retentionApproved, false);
  assert.equal(snapshot.gate.subprocessorsReviewed, false);
  assert.equal(snapshot.gate.privacyPolicyApproved, true);
  assert.equal(snapshot.gate.termsApproved, false);
});

test('L source does not invent statutory deadlines, legal bases or subprocessors', async () => {
  const [schema, migration, service, docs] = await Promise.all([
    readFile('prisma/schema.prisma', 'utf8'),
    readFile(
      'prisma/migrations/20260928143000_lgpd_operational_core/migration.sql',
      'utf8',
    ),
    readFile(
      'src/modules/privacy/privacy-governance.service.ts',
      'utf8',
    ),
    readFile('docs/L_LGPD_LEGAL_OPERATIONAL_CORE.md', 'utf8'),
  ]);

  assert.match(schema, /model DataSubjectRequest/);
  assert.match(schema, /model DataRetentionPolicy/);
  assert.match(schema, /model SubprocessorRecord/);
  assert.match(schema, /model LegalDocument/);
  assert.match(schema, /model LegalAcceptance/);

  assert.doesNotMatch(
    migration,
    /15\s*days|30\s*days|90\s*days|365\s*days/i,
  );
  assert.doesNotMatch(
    service,
    /consentimento|legitimo interesse|obrigacao legal/i,
  );
  assert.match(docs, /HUMAN\/LEGAL APPROVAL REQUIRED/);
  assert.match(docs, /does \*\*not\*\* hard-code a statutory deadline/);
});
