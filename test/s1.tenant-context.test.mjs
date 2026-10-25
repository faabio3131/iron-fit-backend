import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveActiveTenantContext } = require('../dist/src/modules/auth/tenant-context.js');

function assignment(gymId, roleName, permissions, gymName = gymId, active = true) {
  return {
    gymId,
    gym: gymId ? { id: gymId, name: gymName, active } : null,
    role: {
      name: roleName,
      rolePermissions: permissions.map((name) => ({
        permission: { name },
      })),
    },
  };
}

test('multi-gym user must explicitly select an active tenant', () => {
  const result = resolveActiveTenantContext([
    assignment('gym-a', 'OWNER', ['students:read']),
    assignment('gym-b', 'MANAGER', ['financial:read']),
  ]);

  assert.equal(result.requiresTenantSelection, true);
  assert.equal(result.activeGymId, null);
  assert.deepEqual(
    result.availableTenants.map((tenant) => tenant.id),
    ['gym-a', 'gym-b'],
  );
});

test('selected Gym B never inherits Gym A roles or permissions', () => {
  const result = resolveActiveTenantContext(
    [
      assignment('gym-a', 'OWNER', ['students:read']),
      assignment('gym-b', 'MANAGER', ['financial:read']),
    ],
    'gym-b',
  );

  assert.equal(result.activeGymId, 'gym-b');
  assert.equal(result.scope, 'tenant');
  assert.deepEqual(result.roles, ['MANAGER']);
  assert.deepEqual(result.permissions, ['financial:read']);
  assert.equal(result.permissions.includes('students:read'), false);
});

test('cross-tenant selection is denied when the user has no membership', () => {
  assert.throws(
    () =>
      resolveActiveTenantContext(
        [assignment('gym-a', 'OWNER', ['students:read'])],
        'gym-b',
      ),
    /TENANT_NOT_ALLOWED/,
  );
});

test('single-gym user gets deterministic tenant context without first-role ordering', () => {
  const result = resolveActiveTenantContext([
    assignment('gym-a', 'TRAINER', ['workouts:write']),
    assignment('gym-a', 'MANAGER', ['students:read']),
  ]);

  assert.equal(result.activeGymId, 'gym-a');
  assert.equal(result.requiresTenantSelection, false);
  assert.deepEqual(new Set(result.roles), new Set(['TRAINER', 'MANAGER']));
  assert.deepEqual(
    new Set(result.permissions),
    new Set(['workouts:write', 'students:read']),
  );
});

test('global SUPER_ADMIN remains explicit global context and does not absorb tenant roles', () => {
  const result = resolveActiveTenantContext([
    assignment(null, 'SUPER_ADMIN', ['audit:read']),
    assignment('gym-a', 'OWNER', ['students:write']),
  ]);

  assert.equal(result.scope, 'global');
  assert.equal(result.activeGymId, null);
  assert.equal(result.isSuperAdmin, true);
  assert.deepEqual(result.roles, ['SUPER_ADMIN']);
  assert.deepEqual(result.permissions, ['audit:read']);
});

test('inactive gyms are excluded from active tenant choices', () => {
  assert.throws(
    () =>
      resolveActiveTenantContext([
        assignment('gym-a', 'OWNER', ['students:read'], 'Gym A', false),
      ]),
    /TENANT_REQUIRED/,
  );
});

test('stale membership with missing or mismatched gym never grants tenant access', () => {
  const missingGym = assignment('gym-a', 'OWNER', ['financial:read']);
  missingGym.gym = null;
  const mismatchedGym = assignment('gym-a', 'OWNER', ['financial:read']);
  mismatchedGym.gym = { id: 'gym-b', name: 'Other tenant', active: true };
  for (const membership of [missingGym, mismatchedGym]) {
    assert.throws(() => resolveActiveTenantContext([membership]), /TENANT_REQUIRED/);
    assert.throws(() => resolveActiveTenantContext([membership], 'gym-a'), /TENANT_NOT_ALLOWED/);
  }
});
