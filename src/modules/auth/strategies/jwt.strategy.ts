import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  REFRESH_SESSION_MAX_TTL_MS,
  REFRESH_SESSION_PREFIX,
  requireJwtSecret,
} from '../auth-security';
import { resolveActiveTenantContext } from '../tenant-context';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly requireVerifiedEmail: boolean;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(configService),
    });
    this.requireVerifiedEmail =
      configService.get<string>('AUTH_REQUIRE_VERIFIED_EMAIL')?.trim() === 'true';
  }

  async validate(payload: any) {
    if (
      typeof payload?.sub !== 'string' ||
      typeof payload?.sid !== 'string' ||
      !payload.sid
    ) {
      throw new UnauthorizedException();
    }

    const now = new Date();
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          userRoles: {
            where: { active: true },
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
      }),
      this.prisma.session.findUnique({ where: { id: payload.sid } }),
    ]);

    if (
      !user ||
      !user.active ||
      (this.requireVerifiedEmail && !user.emailVerifiedAt) ||
      !session ||
      session.userId !== user.id
    ) {
      throw new UnauthorizedException();
    }

    const absoluteExpiresAt =
      session.absoluteExpiresAt ??
      new Date(session.createdAt.getTime() + REFRESH_SESSION_MAX_TTL_MS);

    if (
      !session.deviceName?.startsWith(REFRESH_SESSION_PREFIX) ||
      session.revokedAt ||
      session.expiresAt <= now ||
      absoluteExpiresAt <= now
    ) {
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

    if (context.requiresTenantSelection) throw new UnauthorizedException();
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
      sessionId: session.id,
      mfaEnabled: user.mfaEnabled,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }
}
