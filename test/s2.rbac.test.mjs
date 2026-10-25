import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  canAssignRole,
  resolveAssignmentGymId,
} = require('../dist/src/common/security/rbac-policy.js');
const { GymsService } = require('../dist/src/modules/gyms/gyms.service.js');
const { UsersController } = require('../dist/src/modules/users/users.controller.js');

test('OWNER cannot assign SUPER_ADMIN', () => {
  assert.equal(canAssignRole(['OWNER'], 'SUPER_ADMIN', false), false);
});

test('MANAGER can assign only strictly lower tenant roles', () => {
  assert.equal(canAssignRole(['MANAGER'], 'OWNER', false), false);
  assert.equal(canAssignRole(['MANAGER'], 'MANAGER', false), false);
  assert.equal(canAssignRole(['MANAGER'], 'TRAINER', false), true);
  assert.equal(canAssignRole(['MANAGER'], 'RECEPTION', false), true);
});

test('OWNER cannot delegate OWNER but can assign MANAGER and lower', () => {
  assert.equal(canAssignRole(['OWNER'], 'OWNER', false), false);
  assert.equal(canAssignRole(['OWNER'], 'MANAGER', false), true);
  assert.equal(canAssignRole(['OWNER'], 'TRAINER', false), true);
});

test('operational roles cannot assign any role', () => {
  assert.equal(canAssignRole(['RECEPTION'], 'TRAINER', false), false);
  assert.equal(canAssignRole(['TRAINER'], 'RECEPTION', false), false);
  assert.equal(canAssignRole(['STUDENT'], 'STUDENT', false), false);
});

test('global SUPER_ADMIN may assign SUPER_ADMIN only without tenant binding', () => {
  assert.equal(canAssignRole(['SUPER_ADMIN'], 'SUPER_ADMIN', true), true);
  assert.equal(
    resolveAssignmentGymId({
      actorGymId: null,
      requestedGymId: null,
      targetRole: 'SUPER_ADMIN',
      isSuperAdmin: true,
    }),
    null,
  );

  assert.throws(
    () =>
      resolveAssignmentGymId({
        actorGymId: null,
        requestedGymId: 'gym-a',
        targetRole: 'SUPER_ADMIN',
        isSuperAdmin: true,
      }),
    /INVALID_SUPER_ADMIN_ASSIGNMENT/,
  );
});

test('tenant administrator cannot assign a user into Gym B while active in Gym A', () => {
  assert.throws(
    () =>
      resolveAssignmentGymId({
        actorGymId: 'gym-a',
        requestedGymId: 'gym-b',
        targetRole: 'TRAINER',
        isSuperAdmin: false,
      }),
    /CROSS_TENANT_ASSIGNMENT/,
  );
});

test('tenant administrator derives assignment gym from active tenant when dto omits gymId', () => {
  assert.equal(
    resolveAssignmentGymId({
      actorGymId: 'gym-a',
      requestedGymId: null,
      targetRole: 'TRAINER',
      isSuperAdmin: false,
    }),
    'gym-a',
  );
});

test('MANAGER can open tenant team workspace but controller keeps creation hierarchy in service policy', () => {
  assert.deepEqual(
    Reflect.getMetadata('roles', UsersController.prototype.findAll),
    ['SUPER_ADMIN', 'OWNER', 'MANAGER'],
  );
  assert.deepEqual(
    Reflect.getMetadata('roles', UsersController.prototype.create),
    ['SUPER_ADMIN', 'OWNER', 'MANAGER'],
  );
});

test('Gym A actor cannot read Gym B through GET /gyms/:id service path', async () => {
  const prisma = {
    gym: {
      findUnique: async () => {
        throw new Error('database should not be reached for cross-tenant lookup');
      },
    },
  };

  const service = new GymsService(prisma);

  await assert.rejects(
    () => service.findOne('gym-b', 'gym-a', false),
    /Academia nao encontrada/,
  );
});

test('SUPER_ADMIN global path can read an explicit gym', async () => {
  const prisma = {
    gym: {
      findUnique: async ({ where }) => ({ id: where.id, name: 'Gym B' }),
    },
  };

  const service = new GymsService(prisma);
  const result = await service.findOne('gym-b', null, true);

  assert.equal(result.id, 'gym-b');
});

test('SUPER_ADMIN bound to Gym A cannot override selected tenant via query', () => {
  const { resolveTenantOperationGymId } = require('../dist/src/common/security/tenant-operation-scope.js');
  assert.equal(resolveTenantOperationGymId({
    activeGymId: 'gym-a', isSuperAdmin: true,
  }), 'gym-a');
  assert.throws(() => resolveTenantOperationGymId({
    activeGymId: 'gym-a', requestedGymId: 'gym-b', isSuperAdmin: true,
  }), /Academia nao encontrada/);
  assert.equal(resolveTenantOperationGymId({
    activeGymId: null, requestedGymId: 'gym-b', isSuperAdmin: true,
  }), 'gym-b');
  assert.throws(() => resolveTenantOperationGymId({
    activeGymId: null, isSuperAdmin: true,
  }), /Academia obrigatoria/);
});
