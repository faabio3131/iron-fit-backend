export interface TenantRoleAssignment {
  gymId: string | null;
  role: {
    name: string;
    rolePermissions: Array<{ permission: { name: string } }>;
  };
  gym?: {
    id: string;
    name: string;
    active: boolean;
  } | null;
}

export interface AvailableTenant {
  id: string;
  name: string;
}

export interface ActiveTenantContext {
  activeGymId: string | null;
  scope: 'global' | 'tenant';
  isSuperAdmin: boolean;
  roles: string[];
  permissions: string[];
  availableTenants: AvailableTenant[];
  requiresTenantSelection: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function listAvailableTenants(assignments: TenantRoleAssignment[]): AvailableTenant[] {
  const tenants = new Map<string, AvailableTenant>();

  for (const assignment of assignments) {
    if (!assignment.gymId || assignment.gym?.active === false) continue;

    tenants.set(assignment.gymId, {
      id: assignment.gymId,
      name: assignment.gym?.name ?? assignment.gymId,
    });
  }

  return [...tenants.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function collectAuthorization(assignments: TenantRoleAssignment[]) {
  return {
    roles: unique(assignments.map((assignment) => assignment.role.name)),
    permissions: unique(
      assignments.flatMap((assignment) =>
        assignment.role.rolePermissions.map((rp) => rp.permission.name),
      ),
    ),
  };
}

export function resolveActiveTenantContext(
  assignments: TenantRoleAssignment[],
  requestedGymId?: string | null,
): ActiveTenantContext {
  const globalAssignments = assignments.filter((assignment) => assignment.gymId === null);
  const globalSuperAdminAssignments = globalAssignments.filter(
    (assignment) => assignment.role.name === 'SUPER_ADMIN',
  );
  const isSuperAdmin = globalSuperAdminAssignments.length > 0;
  const availableTenants = listAvailableTenants(assignments);

  if (requestedGymId) {
    const tenantAssignments = assignments.filter(
      (assignment) =>
        assignment.gymId === requestedGymId && assignment.gym?.active !== false,
    );

    if (tenantAssignments.length === 0) {
      throw new Error('TENANT_NOT_ALLOWED');
    }

    const authorization = collectAuthorization([
      ...globalSuperAdminAssignments,
      ...tenantAssignments,
    ]);

    return {
      activeGymId: requestedGymId,
      scope: 'tenant',
      isSuperAdmin,
      roles: authorization.roles,
      permissions: authorization.permissions,
      availableTenants,
      requiresTenantSelection: false,
    };
  }

  if (isSuperAdmin) {
    const authorization = collectAuthorization(globalSuperAdminAssignments);

    return {
      activeGymId: null,
      scope: 'global',
      isSuperAdmin: true,
      roles: authorization.roles,
      permissions: authorization.permissions,
      availableTenants,
      requiresTenantSelection: false,
    };
  }

  if (availableTenants.length === 0) {
    throw new Error('TENANT_REQUIRED');
  }

  if (availableTenants.length > 1) {
    return {
      activeGymId: null,
      scope: 'tenant',
      isSuperAdmin: false,
      roles: [],
      permissions: [],
      availableTenants,
      requiresTenantSelection: true,
    };
  }

  const activeGymId = availableTenants[0].id;
  const tenantAssignments = assignments.filter(
    (assignment) =>
      assignment.gymId === activeGymId && assignment.gym?.active !== false,
  );
  const authorization = collectAuthorization(tenantAssignments);

  return {
    activeGymId,
    scope: 'tenant',
    isSuperAdmin: false,
    roles: authorization.roles,
    permissions: authorization.permissions,
    availableTenants,
    requiresTenantSelection: false,
  };
}
