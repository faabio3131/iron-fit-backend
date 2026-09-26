import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthActionTokenKind,
  Prisma,
} from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuditRecordInput, AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  gymIdFromRefreshSessionName,
  hashOpaqueToken,
  newRefreshSecret,
  opaqueHashesEqual,
  REFRESH_SESSION_MAX_TTL_MS,
  REFRESH_SESSION_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  refreshSessionName,
  securityKeyHash,
} from './auth-security';
import { AuthSecurityService } from './auth-security.service';
import { resolveActiveTenantContext } from './tenant-context';

const DUMMY_BCRYPT_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5p8Ao8MZsLz8JqF0EZyNP7Wm1EMKq';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly security: AuthSecurityService,
  ) {}

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
      // Authentication outcomes cannot expose audit-storage failure to callers.
    }
  }

  private normalizedEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async recordLoginEvent(
    action:
      | 'AUTH_LOGIN_FAILED'
      | 'AUTH_LOGIN_SUCCESS'
      | 'AUTH_LOGIN_MFA_REQUIRED'
      | 'AUTH_LOGIN_MFA_FAILED',
    email: string,
    userId?: string | null,
    ipAddress?: string | null,
  ) {
    await this.safeAudit({
      userId: userId ?? null,
      action,
      entity: 'AuthLogin',
      entityId: securityKeyHash('AUTH_LOGIN_IDENTITY', email),
      ipAddress: ipAddress ? securityKeyHash('AUTH_LOGIN_IP', ipAddress) : null,
    });
  }

  async validateUser(
    email: string,
    password: string,
    ipAddress?: string | null,
  ): Promise<any> {
    const normalizedEmail = this.normalizedEmail(email);
    await this.security.assertLoginAllowed(normalizedEmail, ipAddress);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: this.userInclude(),
    });

    const passwordHash = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
    const isPasswordValid = await bcrypt.compare(password, passwordHash);
    if (!user || !user.active || !isPasswordValid) {
      await this.security.recordLoginFailure(normalizedEmail, ipAddress);
      await this.recordLoginEvent(
        'AUTH_LOGIN_FAILED',
        normalizedEmail,
        user?.id ?? null,
        ipAddress,
      );
      throw new UnauthorizedException('Credenciais invalidas');
    }

    if (this.security.requireVerifiedEmail() && !user.emailVerifiedAt) {
      await this.recordLoginEvent(
        'AUTH_LOGIN_FAILED',
        normalizedEmail,
        user.id,
        ipAddress,
      );
      throw new UnauthorizedException('Verificacao de email obrigatoria');
    }

    await this.security.recordLoginSuccess(normalizedEmail);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      mfaEnabled: user.mfaEnabled,
      mfaSecret: user.mfaSecret,
      emailVerifiedAt: user.emailVerifiedAt,
      userRoles: user.userRoles,
    };
  }

  private signAccessToken(user: any, context: any, sessionId: string) {
    const payload = {
      sub: user.id,
      sid: sessionId,
      email: user.email,
      activeGymId: context.activeGymId,
      scope: context.scope,
    };
    return this.jwtService.sign(payload);
  }

  private sessionAbsoluteExpiry(createdAt = new Date()): Date {
    return new Date(createdAt.getTime() + REFRESH_SESSION_MAX_TTL_MS);
  }

  private async createRefreshSession(
    userId: string,
    activeGymId: string | null,
    ipAddress?: string | null,
  ) {
    const secret = newRefreshSecret();
    const now = new Date();
    const absoluteExpiresAt = this.sessionAbsoluteExpiry(now);
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + REFRESH_TOKEN_TTL_MS, absoluteExpiresAt.getTime()),
    );

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashOpaqueToken(secret),
        previousRefreshTokenHash: null,
        deviceName: refreshSessionName(activeGymId),
        ipAddress: ipAddress ? securityKeyHash('AUTH_SESSION_IP', ipAddress) : null,
        expiresAt: idleExpiresAt,
        absoluteExpiresAt,
        lastUsedAt: now,
      },
    });

    await this.safeAudit({
      gymId: activeGymId,
      userId,
      action: 'AUTH_REFRESH_SESSION_CREATED',
      entity: 'Session',
      entityId: session.id,
      next: {
        expiresAt: session.expiresAt,
        absoluteExpiresAt,
      },
    });

    return {
      session,
      refreshToken: `${session.id}.${secret}`,
    };
  }

  async login(
    user: any,
    requestedGymId?: string,
    mfaCode?: string,
    recoveryCode?: string,
    ipAddress?: string | null,
  ) {
    let context;
    try {
      context = resolveActiveTenantContext(user.userRoles, requestedGymId);
    } catch {
      throw new UnauthorizedException('Tenant invalido ou indisponivel');
    }

    if (context.requiresTenantSelection) {
      return {
        requires_mfa: user.mfaEnabled,
        requires_tenant_selection: true,
        tenants: context.availableTenants,
        user: { id: user.id, email: user.email, name: user.name },
      };
    }

    if (user.mfaEnabled && !mfaCode && !recoveryCode) {
      await this.recordLoginEvent(
        'AUTH_LOGIN_MFA_REQUIRED',
        user.email,
        user.id,
        ipAddress,
      );
      return {
        requires_mfa: true,
        requires_tenant_selection: false,
      };
    }

    if (
      user.mfaEnabled &&
      !(await this.security.verifySecondFactor(user, mfaCode, recoveryCode))
    ) {
      await this.security.recordLoginFailure(user.email, ipAddress);
      await this.recordLoginEvent(
        'AUTH_LOGIN_MFA_FAILED',
        user.email,
        user.id,
        ipAddress,
      );
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const { session, refreshToken } = await this.createRefreshSession(
      user.id,
      context.activeGymId,
      ipAddress,
    );

    await this.recordLoginEvent(
      'AUTH_LOGIN_SUCCESS',
      user.email,
      user.id,
      ipAddress,
    );

    return {
      access_token: this.signAccessToken(user, context, session.id),
      refresh_token: refreshToken,
      requires_mfa: false,
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
        mfaEnabled: user.mfaEnabled,
        emailVerified: Boolean(user.emailVerifiedAt),
      },
    };
  }

  private parseRefreshToken(refreshToken: string) {
    const separator = refreshToken.indexOf('.');
    if (separator <= 0 || separator >= refreshToken.length - 1) {
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
    const presentedHash = hashOpaqueToken(secret);
    const now = new Date();

    if (
      session?.previousRefreshTokenHash &&
      opaqueHashesEqual(session.previousRefreshTokenHash, presentedHash)
    ) {
      await this.prisma.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.safeAudit({
        gymId: gymIdFromRefreshSessionName(session.deviceName),
        userId: session.userId,
        action: 'AUTH_REFRESH_REPLAY_REVOKED',
        entity: 'Session',
        entityId: session.id,
        next: { revokedAt: now },
      });
      throw new UnauthorizedException('Refresh token invalido');
    }

    const absoluteExpiresAt =
      session?.absoluteExpiresAt ??
      (session ? this.sessionAbsoluteExpiry(session.createdAt) : null);

    if (
      !session ||
      !session.deviceName?.startsWith(REFRESH_SESSION_PREFIX) ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !absoluteExpiresAt ||
      absoluteExpiresAt <= now ||
      !opaqueHashesEqual(session.refreshTokenHash, presentedHash)
    ) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: this.userInclude(),
    });
    if (
      !user ||
      !user.active ||
      (this.security.requireVerifiedEmail() && !user.emailVerifiedAt)
    ) {
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
    const nextExpiresAt = new Date(
      Math.min(
        now.getTime() + REFRESH_TOKEN_TTL_MS,
        absoluteExpiresAt.getTime(),
      ),
    );
    const updated = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        refreshTokenHash: session.refreshTokenHash,
      },
      data: {
        previousRefreshTokenHash: session.refreshTokenHash,
        refreshTokenHash: hashOpaqueToken(rotatedSecret),
        expiresAt: nextExpiresAt,
        absoluteExpiresAt,
        lastUsedAt: now,
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
      next: { expiresAt: nextExpiresAt, absoluteExpiresAt },
    });

    return {
      access_token: this.signAccessToken(user, context, session.id),
      refresh_token: `${session.id}.${rotatedSecret}`,
      requires_mfa: false,
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

  async requestPasswordReset(
    email: string,
    ipAddress?: string | null,
  ) {
    const normalized = this.normalizedEmail(email);
    await this.security.assertRecoveryRequestAllowed(normalized, ipAddress);
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    if (user?.active) {
      try {
        const issued = await this.security.issueActionToken(
          user.id,
          AuthActionTokenKind.PASSWORD_RESET,
          user.email,
        );
        await this.safeAudit({
          userId: user.id,
          action: 'AUTH_PASSWORD_RESET_REQUESTED',
          entity: 'AuthActionToken',
          entityId: issued.record.id,
          next: { expiresAt: issued.record.expiresAt, deliveryStatus: 'PENDING' },
        });
      } catch {
        await this.safeAudit({
          userId: user.id,
          action: 'AUTH_ACTION_DELIVERY_UNAVAILABLE',
          entity: 'User',
          entityId: user.id,
          next: { kind: 'PASSWORD_RESET' },
        });
      }
    }

    return { accepted: true };
  }

  async confirmPasswordReset(token: string, newPassword: string) {
    this.security.assertPasswordPolicy(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const record = await this.security.consumeActionTokenWithTx(
        tx,
        token,
        AuthActionTokenKind.PASSWORD_RESET,
      );
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: now },
      });
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          userId: record.userId,
          action: 'AUTH_PASSWORD_RESET_COMPLETED',
          entity: 'User',
          entityId: record.userId,
          next: { sessionsRevokedAt: now },
        },
        tx,
      );
      return { reset: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async requestEmailVerification(
    email: string,
    ipAddress?: string | null,
  ) {
    const normalized = this.normalizedEmail(email);
    await this.security.assertRecoveryRequestAllowed(normalized, ipAddress);
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    if (user?.active && !user.emailVerifiedAt) {
      try {
        const issued = await this.security.issueActionToken(
          user.id,
          AuthActionTokenKind.EMAIL_VERIFICATION,
          user.email,
        );
        await this.safeAudit({
          userId: user.id,
          action: 'AUTH_EMAIL_VERIFICATION_REQUESTED',
          entity: 'AuthActionToken',
          entityId: issued.record.id,
          next: { expiresAt: issued.record.expiresAt, deliveryStatus: 'PENDING' },
        });
      } catch {
        await this.safeAudit({
          userId: user.id,
          action: 'AUTH_ACTION_DELIVERY_UNAVAILABLE',
          entity: 'User',
          entityId: user.id,
          next: { kind: 'EMAIL_VERIFICATION' },
        });
      }
    }

    return { accepted: true };
  }

  async confirmEmailVerification(token: string) {
    return this.prisma.$transaction(async (tx) => {
      const record = await this.security.consumeActionTokenWithTx(
        tx,
        token,
        AuthActionTokenKind.EMAIL_VERIFICATION,
      );
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.record(
        {
          userId: record.userId,
          action: 'AUTH_EMAIL_VERIFIED',
          entity: 'User',
          entityId: record.userId,
        },
        tx,
      );
      return { verified: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    mfaCode?: string,
    recoveryCode?: string,
  ) {
    await this.security.assertStepUp(
      userId,
      currentPassword,
      mfaCode,
      recoveryCode,
    );
    this.security.assertPasswordPolicy(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: now },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          userId,
          action: 'AUTH_PASSWORD_CHANGED',
          entity: 'User',
          entityId: userId,
          next: { sessionsRevokedAt: now },
        },
        tx,
      );
    });
    return { changed: true, reloginRequired: true };
  }

  async requestEmailChange(
    userId: string,
    currentPassword: string,
    newEmail: string,
    mfaCode?: string,
    recoveryCode?: string,
  ) {
    await this.security.assertStepUp(
      userId,
      currentPassword,
      mfaCode,
      recoveryCode,
    );
    const normalized = this.normalizedEmail(newEmail);
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Alteracao de email indisponivel');
    }
    const issued = await this.security.issueActionToken(
      userId,
      AuthActionTokenKind.EMAIL_CHANGE,
      normalized,
    );
    await this.safeAudit({
      userId,
      action: 'AUTH_EMAIL_CHANGE_REQUESTED',
      entity: 'AuthActionToken',
      entityId: issued.record.id,
      next: {
        targetEmailHash: securityKeyHash('AUTH_EMAIL_CHANGE_TARGET', normalized),
        expiresAt: issued.record.expiresAt,
        deliveryStatus: 'PENDING',
      },
    });
    return { accepted: true };
  }

  async confirmEmailChange(token: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const record = await this.security.consumeActionTokenWithTx(
        tx,
        token,
        AuthActionTokenKind.EMAIL_CHANGE,
      );
      if (!record.targetEmail) {
        throw new UnauthorizedException('Token invalido ou expirado');
      }
      const existing = await tx.user.findUnique({
        where: { email: record.targetEmail },
        select: { id: true },
      });
      if (existing && existing.id !== record.userId) {
        throw new ConflictException('Alteracao de email indisponivel');
      }
      await tx.user.update({
        where: { id: record.userId },
        data: { email: record.targetEmail, emailVerifiedAt: now },
      });
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          userId: record.userId,
          action: 'AUTH_EMAIL_CHANGED',
          entity: 'User',
          entityId: record.userId,
          next: {
            emailHash: securityKeyHash('AUTH_EMAIL', record.targetEmail),
            sessionsRevokedAt: now,
          },
        },
        tx,
      );
      return { changed: true, reloginRequired: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listSessions(userId: string, currentSessionId?: string | null) {
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        deviceName: { startsWith: REFRESH_SESSION_PREFIX },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((session) => {
      const absoluteExpiresAt =
        session.absoluteExpiresAt ?? this.sessionAbsoluteExpiry(session.createdAt);
      return {
        id: session.id,
        activeGymId: gymIdFromRefreshSessionName(session.deviceName),
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.expiresAt,
        absoluteExpiresAt,
        revokedAt: session.revokedAt,
        current: session.id === currentSessionId,
        active:
          !session.revokedAt &&
          session.expiresAt > now &&
          absoluteExpiresAt > now,
      };
    });
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    currentPassword: string,
    mfaCode?: string,
    recoveryCode?: string,
  ) {
    await this.security.assertStepUp(
      userId,
      currentPassword,
      mfaCode,
      recoveryCode,
    );
    const revokedAt = new Date();
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt },
    });
    await this.safeAudit({
      userId,
      action: 'AUTH_SESSION_REVOKED',
      entity: 'Session',
      entityId: sessionId,
      next: { revokedAt },
    });
    return { revoked: result.count === 1 };
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string | null | undefined,
    currentPassword: string,
    mfaCode?: string,
    recoveryCode?: string,
  ) {
    await this.security.assertStepUp(
      userId,
      currentPassword,
      mfaCode,
      recoveryCode,
    );
    const revokedAt = new Date();
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt },
    });
    await this.safeAudit({
      userId,
      action: 'AUTH_OTHER_SESSIONS_REVOKED',
      entity: 'Session',
      entityId: currentSessionId ?? null,
      next: { revokedAt, count: result.count },
    });
    return { revokedCount: result.count };
  }

  beginMfaEnrollment(userId: string, currentPassword: string) {
    return this.security.beginMfaEnrollment(userId, currentPassword);
  }

  confirmMfaEnrollment(userId: string, code: string) {
    return this.security.confirmMfaEnrollment(userId, code);
  }

  disableMfa(
    userId: string,
    currentPassword: string,
    mfaCode?: string,
    recoveryCode?: string,
  ) {
    return this.security.disableMfa(
      userId,
      currentPassword,
      mfaCode,
      recoveryCode,
    );
  }
}
