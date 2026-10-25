import test from 'node:test';
import assert from 'node:assert/strict';

const { UsersService } = await import('../dist/src/modules/users/users.service.js');

function ownerActor() {
  return {
    id: 'owner-1',
    roles: ['OWNER'],
    activeGymId: 'gym-1',
    gymId: 'gym-1',
    isSuperAdmin: false,
    scope: 'tenant',
  };
}

test('O5 invite reuses canonical password setup flow without exposing a temporary password', async () => {
  const resetEmails = [];
  const prisma = {
    user: {
      findUnique: async () => null,
      create: async ({ data }) => ({
        id: 'user-1',
        email: data.email,
        name: data.name,
        active: true,
      }),
    },
    gym: {
      findFirst: async ({ where }) => where.id === 'gym-1' ? { id: 'gym-1', active: true } : null,
    },
    role: {
      findUnique: async ({ where }) => ({ id: 'role-manager', name: where.name }),
    },
    userRole: {
      create: async () => ({ id: 'membership-1' }),
    },
    auditLog: {
      create: async ({ data }) => ({ id: 'audit-1', ...data }),
    },
  };
  const auth = {
    requestPasswordReset: async (email) => {
      resetEmails.push(email);
      return { accepted: true };
    },
  };
  const service = new UsersService(prisma, auth);

  const invited = await service.invite({
    email: 'Manager@Example.com',
    name: 'Manager Invite',
    roleName: 'MANAGER',
  }, ownerActor());

  assert.equal(invited.email, 'manager@example.com');
  assert.equal(invited.invitation.accepted, true);
  assert.equal(invited.invitation.delivery, 'PASSWORD_SETUP_EMAIL');
  assert.deepEqual(resetEmails, ['manager@example.com']);
  assert.equal(Object.prototype.hasOwnProperty.call(invited, 'password'), false);
});

test('O5 tenant membership disable revokes only the active tenant session', async () => {
  const updates = [];
  const revoked = [];
  const prisma = {
    userRole: {
      findFirst: async () => ({
        id: 'membership-1',
        userId: 'manager-1',
        roleId: 'role-manager',
        active: true,
        role: { id: 'role-manager', name: 'MANAGER' },
        user: { id: 'manager-1' },
      }),
      update: async ({ data }) => {
        updates.push(data);
        return { id: 'membership-1', ...data };
      },
    },
    session: {
      updateMany: async ({ where, data }) => {
        revoked.push({ where, data });
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }) => ({ id: 'audit-2', ...data }),
    },
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return operation(prisma);
    },
  };
  const service = new UsersService(prisma, { requestPasswordReset: async () => ({ accepted: true }) });

  const result = await service.updateMembershipStatus('manager-1', false, ownerActor());

  assert.equal(result.active, false);
  assert.deepEqual(updates, [{ active: false }]);
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].where.userId, 'manager-1');
  assert.match(revoked[0].where.deviceName, /gym-1/);
});

test('O5 team read model exposes role, membership status and effective role permissions', async () => {
  let query = null;
  const prisma = {
    user: {
      findMany: async (args) => {
        query = args;
        return [{
          id: 'trainer-1',
          email: 'trainer@example.com',
          name: 'Trainer',
          phone: null,
          active: true,
          createdAt: new Date('2026-09-30T00:00:00Z'),
          userRoles: [{
            active: true,
            role: {
              name: 'TRAINER',
              rolePermissions: [
                { permission: { name: 'workouts.read' } },
                { permission: { name: 'assessments.write' } },
              ],
            },
          }],
        }];
      },
    },
  };
  const service = new UsersService(prisma, { requestPasswordReset: async () => ({ accepted: true }) });

  const rows = await service.findAll(ownerActor());

  assert.equal(query.where.userRoles.some.gymId, 'gym-1');
  assert.deepEqual(rows[0].permissions, ['workouts.read', 'assessments.write']);
  assert.equal(rows[0].roleName, 'TRAINER');
  assert.equal(rows[0].membershipActive, true);
  assert.equal(rows[0].canManage, true);
});

test('O5 OWNER cannot change or disable another OWNER membership', async () => {
  const prisma = {
    userRole: {
      findFirst: async () => ({
        id: 'membership-owner-2',
        userId: 'owner-2',
        roleId: 'role-owner',
        active: true,
        role: { id: 'role-owner', name: 'OWNER' },
        user: { id: 'owner-2' },
      }),
    },
  };
  const service = new UsersService(prisma, { requestPasswordReset: async () => ({ accepted: true }) });

  await assert.rejects(
    () => service.updateMembershipStatus('owner-2', false, ownerActor()),
    /Membro fora da sua autoridade de gestao/,
  );
});
