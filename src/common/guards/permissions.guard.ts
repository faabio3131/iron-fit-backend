import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PERMISSION_ROLES_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const authorizedRoles = this.reflector.getAllAndOverride<string[]>(
      PERMISSION_ROLES_KEY, [context.getHandler(), context.getClass()],
    ) ?? [];
    return authorizedRoles.some((role) => user?.roles?.includes(role)) ||
      requiredPermissions.some((permission) => user?.permissions?.includes(permission));
  }
}
