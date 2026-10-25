import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { UsersService } = require('../dist/src/modules/users/users.service.js');

const actor = {
  id: 'owner-1', roles: ['OWNER'], activeGymId: 'gym-a',
  gymId: 'gym-a', isSuperAdmin: false, scope: 'tenant',
};
function roleMembership() {
  return {
    id: 'membership-1', userId: 'target-1', gymId: 'gym-a',
    roleId: 'role-manager', active: true,
    role: { id: 'role-manager', name: 'MANAGER' },
    user: { id: 'target-1' },
  };
}
function knownError(code) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code, clientVersion: '6.19.3',
  });
}

test('C02 revoked membership cannot race with concurrent promotion to OWNER', async () => {
  let sessionsChanged = 0;
  let audited = 0;
  const prisma = {
    userRole: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { userId: 'target-1', gymId: 'gym-a' });
        return roleMembership();
      },
    },
    $transaction: async (operation) => operation({
      userRole: {
        update: async ({ where, data }) => {
          assert.deepEqual(where, {
            id: 'membership-1', gymId: 'gym-a',
            roleId: 'role-manager', active: true,
          });
          assert.deepEqual(data, { active: false });
          throw knownError('P2025'); // Changed to OWNER after the policy read.
        },
      },
      session: { updateMany: async () => { sessionsChanged++; } },
      auditLog: { create: async () => { audited++; } },
    }),
  };
  const service = new UsersService(prisma, {});
  await assert.rejects(
    () => service.updateMembershipStatus('target-1', false, actor),
    error => error?.getStatus?.() === 409,
  );
  assert.equal(sessionsChanged, 0);
  assert.equal(audited, 0);
});

test('C02 stale team role change does not overwrite a newer role or audit success', async () => {
  let audited = 0;
  const prisma = {
    userRole: { findFirst: async () => roleMembership() },
    role: { findUnique: async () => ({ id: 'role-trainer', name: 'TRAINER' }) },
    $transaction: async (operation) => operation({
      userRole: { update: async ({ where }) => {
        assert.equal(where.gymId, 'gym-a');
        assert.equal(where.roleId, 'role-manager');
        assert.equal(where.active, true);
        throw knownError('P2025');
      } },
      auditLog: { create: async () => { audited++; } },
    }),
  };
  const service = new UsersService(prisma, {});
  await assert.rejects(
    () => service.updateMembershipRole('target-1', 'TRAINER', actor),
    error => error?.getStatus?.() === 409,
  );
  assert.equal(audited, 0);
});

test('C02 role update records canonical tenant audit within the same transaction', async () => {
  const updates = [];
  const audits = [];
  let transactions = 0;
  const prisma = {
    userRole: { findFirst: async () => roleMembership() },
    role: { findUnique: async () => ({ id: 'role-trainer', name: 'TRAINER' }) },
    $transaction: async (operation, options) => {
      transactions++;
      assert.equal(options.isolationLevel, 'Serializable');
      return operation({
        userRole: {
          update: async (args) => {
            updates.push(args);
            return { id: 'membership-1', ...args.data };
          },
        },
        auditLog: { create: async ({ data }) => {
          audits.push(data);
          return { id: 'audit-1', ...data };
        } },
      });
    },
  };
  const service = new UsersService(prisma, {});
  const result = await service.updateMembershipRole('target-1', 'TRAINER', actor);
  assert.equal(result.roleName, 'TRAINER');
  assert.equal(transactions, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where, {
    id: 'membership-1', gymId: 'gym-a', roleId: 'role-manager', active: true,
  });
  assert.equal(updates[0].data.assignedBy, 'owner-1');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].gymId, 'gym-a');
  assert.equal(audits[0].action, 'USER_ROLE_CHANGED');
});
