import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const schema = read('prisma', 'schema.prisma');
const migration = read(
  'prisma',
  'migrations',
  '20260905044200_equipment_catalog_candidate_governance',
  'migration.sql',
);
const service = read('src', 'modules', 'equipments', 'equipments.service.ts');
const controller = read('src', 'modules', 'equipments', 'equipments.controller.ts');
const submitDto = read(
  'src',
  'modules',
  'equipments',
  'dto',
  'submit-equipment-catalog-candidate.dto.ts',
);
const reviewDto = read(
  'src',
  'modules',
  'equipments',
  'dto',
  'review-equipment-catalog-candidate.dto.ts',
);
const docs = read('docs', 'EQ5_CATALOG_GOVERNANCE_CANDIDATE_CERTIFICATION.md');

test('EQ5 adds an explicit relational candidate domain with durable idempotency', () => {
  assert.ok(schema.includes('enum EquipmentCatalogCandidateStatus'));
  assert.ok(schema.includes('model EquipmentCatalogCandidate'));
  assert.ok(schema.includes('@@unique([gymId, fingerprint])'));
  assert.ok(schema.includes('resolvedCatalogItem   EquipmentCatalogItem?'));
  assert.ok(schema.includes('@relation("EquipmentCandidateSubmittedBy"'));
  assert.ok(schema.includes('@relation("EquipmentCandidateReviewedBy"'));

  assert.ok(migration.includes('CREATE TYPE "EquipmentCatalogCandidateStatus"'));
  assert.ok(migration.includes('CREATE TABLE "EquipmentCatalogCandidate"'));
  assert.ok(migration.includes('EquipmentCatalogCandidate_gymId_fingerprint_key'));
  assert.ok(migration.includes('REFERENCES "Gym"("id")'));
  assert.ok(migration.includes('REFERENCES "EquipmentCatalogItem"("id")'));
  assert.ok(migration.includes('ON DELETE RESTRICT'));
});

test('EQ5 candidate intake never accepts tenant authority in request body', () => {
  assert.equal(/\bgymId\b/.test(submitDto), false, 'candidate body must not contain gymId');
  assert.ok(controller.includes("@Post('catalog/candidates')"));
  assert.ok(controller.includes('resolveTenantOperationGymId'));
  assert.ok(controller.includes('submitCatalogCandidate(dto, gymId, user.id)'));

  const start = service.indexOf('async submitCatalogCandidate');
  const end = service.indexOf('\n  async findCatalogCandidates', start);
  const section = service.slice(start, end);
  assert.ok(section.includes('await this.ensureActiveGym(gymId)'));
  assert.ok(section.includes('gymId,'));
  assert.ok(section.includes("TransactionIsolationLevel.Serializable"));
  assert.ok(section.includes('EQUIPMENT_CATALOG_CANDIDATE_SUBMITTED'));
});

test('EQ5 submissions are deterministic, duplicate-safe and fail closed when catalog already knows the item', () => {
  assert.ok(service.includes("createHash('sha256')"));
  assert.ok(service.includes('candidateFingerprint'));
  assert.ok(service.includes('gymId_fingerprint'));
  assert.ok(service.includes("error.code === 'P2002'"));
  assert.ok(service.includes('Equipamento ja existe no catalogo mestre'));
  assert.ok(service.includes("{ name: { equals: proposedName, mode: 'insensitive' } }"));
});

test('EQ5 keeps tenant candidate reads isolated and governance global reads SUPER_ADMIN-only', () => {
  const tenantStart = service.indexOf('async findCatalogCandidates');
  const tenantEnd = service.indexOf('\n  async findGovernanceCatalogCandidates', tenantStart);
  const tenantSection = service.slice(tenantStart, tenantEnd);
  assert.ok(tenantSection.includes('gymId,'));
  assert.ok(tenantSection.includes('await this.ensureActiveGym(gymId)'));

  assert.ok(controller.includes("@Get('catalog/governance/candidates')"));
  assert.ok(controller.includes("@Post('catalog/governance/candidates/:candidateId/review')"));
  const governanceIndex = controller.indexOf("@Get('catalog/governance/candidates')");
  const governanceSection = controller.slice(governanceIndex, governanceIndex + 700);
  assert.ok(governanceSection.includes("@Roles('SUPER_ADMIN')"));
});

test('EQ5 closes new manual Equipment creation while preserving legacy reads', () => {
  const createStart = service.indexOf('async create(dto: CreateEquipmentDto');
  const createEnd = service.indexOf('\n  async findCatalog', createStart);
  const createSection = service.slice(createStart, createEnd);
  assert.ok(createSection.includes('Cadastro manual de novos equipamentos encerrado'));
  assert.equal(createSection.includes('this.prisma.equipment.create'), false);

  assert.ok(service.includes('async findAll(gymId: string)'));
  assert.ok(service.includes('async findOne(id: string, gymId: string)'));
  assert.ok(docs.includes('registros legados já existentes continuam legíveis'));
});

test('EQ5 APPROVE is the only candidate path that creates global catalog knowledge and it is atomically audited', () => {
  const reviewStart = service.indexOf('async reviewCatalogCandidate');
  const reviewEnd = service.indexOf('\n  async selectCatalog', reviewStart);
  const reviewSection = service.slice(reviewStart, reviewEnd);

  assert.ok(reviewSection.includes('EquipmentCatalogCandidateDecision.APPROVE'));
  assert.ok(reviewSection.includes('tx.equipmentCatalogItem.create'));
  assert.ok(reviewSection.includes("source: 'EQ5_CANDIDATE_APPROVAL'"));
  assert.ok(reviewSection.includes('Item canonico equivalente ja existe; use decisao MERGE'));
  assert.ok(reviewSection.includes('EQUIPMENT_CATALOG_ITEM_CREATED_FROM_CANDIDATE'));
  assert.ok(reviewSection.includes('EQUIPMENT_CATALOG_CANDIDATE_${nextStatus}'));
  assert.ok(reviewSection.includes('TransactionIsolationLevel.Serializable'));
  assert.equal(reviewSection.includes('tx.equipment.upsert'), false, 'approval must not auto-select tenant inventory');
});

test('EQ5 MERGE and REJECT preserve governed final-state semantics', () => {
  assert.ok(reviewDto.includes("MERGE = 'MERGE'"));
  assert.ok(reviewDto.includes("REJECT = 'REJECT'"));
  assert.ok(service.includes('MERGE exige catalogItemId existente'));
  assert.ok(service.includes('REJECT exige justificativa de revisao'));
  assert.ok(service.includes("if (candidate.status !== 'PENDING')"));
  assert.ok(service.includes('idempotent: true'));
  assert.ok(docs.includes('APPROVE ou MERGE **não seleciona automaticamente**'));
});

test('EQ5 full certification preserves every EQ0-EQ5 permanent suite with no explicit skips', () => {
  const required = [
    'eq0.equipment-taxonomy.test.mjs',
    'eq1.canonical-equipment-catalog.test.mjs',
    'eq2.manufacturer-model-alias-equivalence.test.mjs',
    'eq3.gym-equipment-inventory-selection.test.mjs',
    'eq4.equipment-capability-exercise-mapping.test.mjs',
    'eq5.catalog-governance-candidate-certification.test.mjs',
  ];

  for (const filename of required) {
    const fullPath = path.join(root, 'test', filename);
    assert.equal(fs.existsSync(fullPath), true, `missing permanent EQ suite: ${filename}`);
    const source = fs.readFileSync(fullPath, 'utf8');
    assert.equal(/\btest\.skip\s*\(/.test(source), false, `critical EQ suite cannot skip tests: ${filename}`);
  }

  assert.ok(docs.includes('Somente após esta certificação a Fase D — Fitness Creator Network pode ser liberada.'));
});
