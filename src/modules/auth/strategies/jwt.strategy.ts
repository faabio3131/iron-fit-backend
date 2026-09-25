import { Injectable, UnauthorizedException } from '@nestjs/common';
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
