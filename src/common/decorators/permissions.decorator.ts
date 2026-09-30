import { applyDecorators, SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const PERMISSION_ROLES_KEY = 'permission_roles';
export const PermissionsOrRoles = (permissions: string[], roles: string[]) =>
  applyDecorators(Permissions(...permissions), SetMetadata(PERMISSION_ROLES_KEY, roles));
