import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TenantProductSubscriptionStatus } from '@prisma/client';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveActiveTenantContext } from '../tenant-context';
import { requireJwtSecret } from '../auth-security';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(configService),
    });
  }

  private async synchronizeBoundedSubscription(gymId: string, userId: string) {
    const expired = await this.prisma.tenantProductSubscription.findFirst({
      where: {
        gymId,
        status: TenantProductSubscriptionStatus.ACTIVE,
        effectiveUntil: { lte: new Date() },
      },
      select: { id: true, effectiveUntil: true },
    });
    if (!expired) return;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantProductSubscription.updateMany({
        where: { id: expired.id, status: TenantProductSubscriptionStatus.ACTIVE },
        data: { status: TenantProductSubscriptionStatus.SUSPENDED },
      });
      if (updated.count > 0) {
        await tx.auditLog.create({
          data: {
            gymId,
            userId,
            action: 'COMMERCIAL_TRIAL_EXPIRED',
            entity: 'TenantProductSubscription',
            entityId: expired.id,
            next: { status: 'SUSPENDED', effectiveUntil: expired.effectiveUntil?.toISOString() ?? null },
          },
        });
      }
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: {
            gym: {
              select: {
                id: true,
                name: true,
                active: true,
              },
            },
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException();
    }

    let context;

    try {
      context = resolveActiveTenantContext(
        user.userRoles,
        payload.activeGymId ?? null,
      );
    } catch {
      throw new UnauthorizedException();
    }

    if (context.requiresTenantSelection) {
      throw new UnauthorizedException();
    }

    if (payload.scope && payload.scope !== context.scope) {
      throw new UnauthorizedException();
    }

    if (context.activeGymId) {
      await this.synchronizeBoundedSubscription(context.activeGymId, user.id);
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: context.roles,
      permissions: context.permissions,
      gymId: context.activeGymId,
      activeGymId: context.activeGymId,
      isSuperAdmin: context.isSuperAdmin,
      scope: context.scope,
    };
  }
}
