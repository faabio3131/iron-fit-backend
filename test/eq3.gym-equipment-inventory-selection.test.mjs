import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = fs.readFileSync(path.join(root, 'src', 'modules', 'equipments', 'equipments.service.ts'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'src', 'modules', 'equipments', 'equipments.controller.ts'), 'utf8');
const selectionDto = fs.readFileSync(path.join(root, 'src', 'modules', 'equipments', 'dto', 'select-catalog-equipment.dto.ts'), 'utf8');
const syncScript = fs.readFileSync(path.join(root, 'scripts', 'sync-equipment-catalog.mjs'), 'utf8');
const taxonomy = fs.readFileSync(path.join(root, 'data', 'equipment', 'equipment-taxonomy.v1.tsv'), 'utf8').trim().split(/\r?\n/);

function block(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing marker: ${marker}`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}

test('EQ3 selection DTO never accepts tenant authority from the client', () => {
  assert.ok(selectionDto.includes('catalogItemIds'));
  assert.ok(selectionDto.includes("@IsUUID('4', { each: true })"));
  assert.equal(/\bgymId\b/.test(selectionDto), false);
});

test('EQ3 catalog and selection routes derive tenant from authenticated context', () => {
  assert.ok(controller.includes("@Get('catalog')"));
  assert.ok(controller.includes("@Post('catalog/selection')"));
  assert.ok(controller.includes("@Delete('catalog/:catalogItemId/selection')"));
  assert.ok(controller.includes('resolveTenantOperationGymId'));
  assert.ok(controller.includes('activeGymId: user.activeGymId ?? user.gymId'));
  assert.ok(controller.includes('return this.equipmentsService.selectCatalog(dto, gymId, user.id)'));
});

test('EQ3 selection is idempotent, tenant-scoped and atomically audited', () => {
  const selection = block(service, 'async selectCatalog(');
  assert.ok(selection.includes('gymId_catalogItemId'));
  assert.ok(selection.includes('tx.equipment.upsert'));
  assert.ok(selection.includes("action: 'GYM_EQUIPMENT_CATALOG_SELECTED'"));
  assert.ok(selection.includes('this.audit.record'));
  assert.ok(selection.includes('Prisma.TransactionIsolationLevel.Serializable'));
  assert.equal(selection.includes('equipmentCatalogItem.create'), false, 'tenant selection must never create global catalog items');
});

test('EQ3 deselection only deactivates the tenant inventory item', () => {
  const deselection = block(service, 'async deselectCatalog(');
  assert.ok(deselection.includes('where: { gymId, catalogItemId }'));
  assert.ok(deselection.includes('data: { active: false }'));
  assert.ok(deselection.includes("action: 'GYM_EQUIPMENT_CATALOG_DESELECTED'"));
  assert.equal(deselection.includes('equipmentCatalogItem.update'), false);
  assert.equal(deselection.includes('equipment.delete'), false);
});

test('EQ3 catalog bootstrap is global, idempotent and covers the complete EQ0 taxonomy', () => {
  assert.equal(taxonomy.length - 1, 165);
  assert.ok(syncScript.includes('prisma.equipmentCatalogItem.upsert'));
  assert.ok(syncScript.includes("path.join(root, 'data', 'equipment', 'equipment-taxonomy.v1.tsv')"));
  assert.equal(/\bgymId\b/.test(syncScript), false);
  assert.equal(syncScript.includes('equipment.create'), false);
});
