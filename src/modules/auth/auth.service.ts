import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditRecordInput, AuditService } from '../../common/audit/audit.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { resolveActiveTenantContext } from './tenant-context';
import {
  gymIdFromRefreshSessionName,
  hashOpaqueToken,
  LOGIN_FAILURE_WINDOW_MS,
  loginIdentityHash,
  MAX_LOGIN_FAILURES,
  newRefreshSecret,
  opaqueHashesEqual,
  REFRESH_SESSION_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  refreshSessionName,
} from './auth-security';

@Injectable()
export class AuthService {
  private readonly audit: AuditService;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {
    this.audit = new AuditService(prisma);
  }

  private userInclude() {
    return {
      userRoles: {
        include: {
          gym: { select: { id: true, name: true, active: true } },
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      },
    } as const;
  }

  private async safeAudit(input: AuditRecordInput) {
    try {
      await this.audit.record(input);
    } catch {
      // Authentication outcome must not leak logging failures.
    }
  }

  private async recordLoginEvent(
    action: 'AUTH_LOGIN_FAILED' | 'AUTH_LOGIN_SUCCESS',
    email: string,
    userId?: string | null,
  ) {
    await this.safeAudit({
      userId: userId ?? null,
      action,
      entity: 'AuthLogin',
      entityId: loginIdentityHash(email),
    });
  }

  private async assertLoginNotRateLimited(email: string) {
    const failures = await this.prisma.auditLog.count({
      where: {
        action: 'AUTH_LOGIN_FAILED',
        entity: 'AuthLogin',
        entityId: loginIdentityHash(email),
        createdAt: { gte: new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS) },
      },
    });

    if (failures >= MAX_LOGIN_FAILURES) {
      throw new UnauthorizedException('Credenciais invalidas');
    }
  }

  async validateUser(email: string, password: string): Promise<any> {
    const normalizedEmail = email.trim().toLowerCase();
    await this.assertLoginNotRateLimited(normalizedEmail);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: this.userInclude(),
    });

    if (!user || !user.active) {
      await this.recordLoginEvent('AUTH_LOGIN_FAILED', normalizedEmail, user?.id ?? null);
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      await this.recordLoginEvent('AUTH_LOGIN_FAILED', normalizedEmail, user.id);
      throw new UnauthorizedException('Credenciais invalidas');
    }

    await this.recordLoginEvent('AUTH_LOGIN_SUCCESS', normalizedEmail, user.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      userRoles: user.userRoles,
    };
  }

  private signAccessToken(user: any, context: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      activeGymId: context.activeGymId,
      scope: context.scope,
    };
    return this.jwtService.sign(payload);
  }

  private async createRefreshSession(userId: string, activeGymId: string | null) {
    const secret = newRefreshSecret();
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashOpaqueToken(secret),
        deviceName: refreshSessionName(activeGymId),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    await this.safeAudit({
      gymId: activeGymId,
      userId,
      action: 'AUTH_REFRESH_SESSION_CREATED',
      entity: 'Session',
      entityId: session.id,
      next: { expiresAt: session.expiresAt },
    });

    return `${session.id}.${secret}`;
  }

  async login(user: any, requestedGymId?: string) {
    let context;
    try {
      context = resolveActiveTenantContext(user.userRoles, requestedGymId);
    } catch {
      throw new UnauthorizedException('Tenant invalido ou indisponivel');
    }

    if (context.requiresTenantSelection) {
      return {
        requires_tenant_selection: true,
        tenants: context.availableTenants,
        user: { id: user.id, email: user.email, name: user.name },
      };
    }

    const refreshToken = await this.createRefreshSession(user.id, context.activeGymId);

    return {
      access_token: this.signAccessToken(user, context),
      refresh_token: refreshToken,
      requires_tenant_selection: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: context.roles,
        permissions: context.permissions,
        gymId: context.activeGymId,
        activeGymId: context.activeGymId,
        isSuperAdmin: context.isSuperAdmin,
        scope: context.scope,
      },
    };
  }

  private parseRefreshToken(refreshToken: string) {
    const separator = refreshToken.indexOf('.');
    if (separator <= 0) {
      throw new UnauthorizedException('Refresh token invalido');
    }
    return {
      sessionId: refreshToken.slice(0, separator),
      secret: refreshToken.slice(separator + 1),
    };
  }

  async refresh(refreshToken: string) {
    const { sessionId, secret } = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (
      !session ||
      !session.deviceName?.startsWith(REFRESH_SESSION_PREFIX) ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !opaqueHashesEqual(session.refreshTokenHash, hashOpaqueToken(secret))
    ) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: this.userInclude(),
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const activeGymId = gymIdFromRefreshSessionName(session.deviceName);
    let context;
    try {
      context = resolveActiveTenantContext(user.userRoles, activeGymId);
    } catch {
      throw new UnauthorizedException('Refresh token invalido');
    }
    if (context.requiresTenantSelection) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const rotatedSecret = newRefreshSecret();
    const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const updated = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        refreshTokenHash: session.refreshTokenHash,
      },
      data: {
        refreshTokenHash: hashOpaqueToken(rotatedSecret),
        expiresAt: nextExpiresAt,
      },
    });
    if (updated.count !== 1) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    await this.safeAudit({
      gymId: activeGymId,
      userId: user.id,
      action: 'AUTH_REFRESH_ROTATED',
      entity: 'Session',
      entityId: session.id,
      previous: { expiresAt: session.expiresAt },
      next: { expiresAt: nextExpiresAt },
    });

    return {
      access_token: this.signAccessToken(user, context),
      refresh_token: `${session.id}.${rotatedSecret}`,
      requires_tenant_selection: false,
    };
  }

  async logout(refreshToken: string) {
    const { sessionId, secret } = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (
      !session ||
      !session.deviceName?.startsWith(REFRESH_SESSION_PREFIX) ||
      !opaqueHashesEqual(session.refreshTokenHash, hashOpaqueToken(secret))
    ) {
      return { revoked: true };
    }

    const revokedAt = new Date();
    await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt },
    });

    await this.safeAudit({
      gymId: gymIdFromRefreshSessionName(session.deviceName),
      userId: session.userId,
      action: 'AUTH_LOGOUT',
      entity: 'Session',
      entityId: session.id,
      next: { revokedAt },
    });

    return { revoked: true };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('Email ja cadastrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { email, name: dto.name, phone: dto.phone, passwordHash },
    });

    await this.safeAudit({
      userId: user.id,
      action: 'AUTH_REGISTERED',
      entity: 'User',
      entityId: user.id,
      next: { active: user.active },
    });

    return { id: user.id, email: user.email, name: user.name };
  }
}
