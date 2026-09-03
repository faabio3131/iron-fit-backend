const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 100,
  OWNER: 80,
  MANAGER: 60,
  RECEPTION: 40,
  TRAINER: 40,
  STUDENT: 10,
};

export function canAssignRole(
  actorRoles: string[],
  targetRole: string,
  isSuperAdmin: boolean,
): boolean {
  if (!(targetRole in ROLE_RANK)) return false;
  if (targetRole === 'SUPER_ADMIN') return isSuperAdmin;
  if (isSuperAdmin) return true;

  const actorRank = Math.max(
    0,
    ...actorRoles.map((role) => ROLE_RANK[role] ?? 0),
  );

  return actorRank >= ROLE_RANK[targetRole] && actorRank >= ROLE_RANK.MANAGER;
}

export function resolveAssignmentGymId(params: {
  actorGymId?: string | null;
  requestedGymId?: string | null;
  targetRole: string;
  isSuperAdmin: boolean;
}): string | null {
  const {
    actorGymId,
    requestedGymId,
    targetRole,
    isSuperAdmin,
  } = params;

  if (targetRole === 'SUPER_ADMIN') {
    if (!isSuperAdmin || requestedGymId) {
      throw new Error('INVALID_SUPER_ADMIN_ASSIGNMENT');
    }
    return null;
  }

  if (isSuperAdmin) {
    if (!requestedGymId) {
      throw new Error('TENANT_REQUIRED');
    }
    return requestedGymId;
  }

  if (!actorGymId) {
    throw new Error('TENANT_REQUIRED');
  }

  if (requestedGymId && requestedGymId !== actorGymId) {
    throw new Error('CROSS_TENANT_ASSIGNMENT');
  }

  return actorGymId;
}
