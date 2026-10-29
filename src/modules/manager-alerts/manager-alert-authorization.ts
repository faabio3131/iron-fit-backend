import { ManagerAlertCategory, Prisma, RoleName } from '@prisma/client';

export const MANAGER_ALERT_OWNER_ONLY: ManagerAlertCategory[] = [ManagerAlertCategory.STUDENT_BILLING, ManagerAlertCategory.SECURITY];

export function managerAlertRoles(category: ManagerAlertCategory): RoleName[] {
  return MANAGER_ALERT_OWNER_ONLY.includes(category) ? [RoleName.OWNER] : [RoleName.OWNER, RoleName.MANAGER];
}

/** Query-time authority: a historical recipient snapshot never grants current access. */
export function managerAlertLiveAccess(gymId: string, userId: string): Prisma.ManagerAlertWhereInput {
  const recipient = (roles: RoleName[]) => ({
    some: { userId, user: { active: true, userRoles: { some: { gymId, active: true, gym: { active: true }, role: { name: { in: roles } } } } } },
  });
  return { OR: [
    { category: { in: MANAGER_ALERT_OWNER_ONLY }, recipients: recipient([RoleName.OWNER]) },
    { category: { notIn: MANAGER_ALERT_OWNER_ONLY }, recipients: recipient([RoleName.OWNER, RoleName.MANAGER]) },
  ] };
}
