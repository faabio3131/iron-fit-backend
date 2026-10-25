import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthActionTokenKind,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  decryptMfaSecret,
  EMAIL_CHANGE_TTL_MS,
  EMAIL_VERIFICATION_TTL_MS,
  encryptActionSecret,
  encryptMfaSecret,
  hashOpaqueToken,
  newActionSecret,
  newRecoveryCode,
  newTotpSecret,
  PASSWORD_RESET_TTL_MS,
  passwordPolicyViolations,
  securityKeyHash,
  totpUri,
  verifyTotp,
} from './auth-security';

type AuthDb = PrismaService | Prisma.TransactionClient;
const SERIALIZABLE_ATTEMPTS = 3;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

@Injectable()
export class AuthSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === SERIALIZABLE_ATTEMPTS) throw error;
      }
    }
    throw new HttpException(
      'Tente novamente mais tarde',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async consumeBucket(
    scope: string,
    rawKey: string,
    limit: number,
    windowMs: number,
    blockMs: number,
  ) {
    const keyHash = securityKeyHash(scope, rawKey || 'unknown');
    const now = new Date();

    return this.serializable(async (tx) => {
      const current = await tx.authRateLimitBucket.findUnique({
        where: { scope_keyHash: { scope, keyHash } },
      });

      if (current?.blockedUntil && current.blockedUntil > now) {
        throw new HttpException(
        'Tente novamente mais tarde',
        HttpStatus.TOO_MANY_REQUESTS,
      );
      }

      const windowExpired =
        !current || now.getTime() - current.windowStartedAt.getTime() >= windowMs;

      const nextCount = windowExpired ? 1 : current.count + 1;
      const blockedUntil =
        nextCount > limit ? new Date(now.getTime() + blockMs) : null;

      await tx.authRateLimitBucket.upsert({
        where: { scope_keyHash: { scope, keyHash } },
        create: {
          scope,
          keyHash,
          windowStartedAt: now,
          count: nextCount,
          blockedUntil,
        },
        update: {
          windowStartedAt: windowExpired ? now : current!.windowStartedAt,
          count: nextCount,
          blockedUntil,
        },
      });

      if (blockedUntil) {
        throw new HttpException(
        'Tente novamente mais tarde',
        HttpStatus.TOO_MANY_REQUESTS,
      );
      }
    });
  }

  private async assertBucketNotBlocked(scope: string, rawKey: string) {
    const keyHash = securityKeyHash(scope, rawKey || 'unknown');
    const current = await this.prisma.authRateLimitBucket.findUnique({
      where: { scope_keyHash: { scope, keyHash } },
    });
    if (current?.blockedUntil && current.blockedUntil > new Date()) {
      throw new HttpException(
        'Tente novamente mais tarde',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async assertLoginAllowed(email: string, ipAddress?: string | null) {
    await this.consumeBucket(
      'AUTH_LOGIN_REQUEST_IP',
      ipAddress || 'unknown',
      30,
      15 * MINUTE,
      15 * MINUTE,
    );
    await Promise.all([
      this.assertBucketNotBlocked('AUTH_LOGIN_FAILURE_EMAIL', email),
      this.assertBucketNotBlocked(
        'AUTH_LOGIN_FAILURE_IP',
        ipAddress || 'unknown',
      ),
    ]);
  }

  async recordLoginFailure(email: string, ipAddress?: string | null) {
    await Promise.allSettled([
      this.consumeBucket(
        'AUTH_LOGIN_FAILURE_EMAIL',
        email,
        4,
        15 * MINUTE,
        15 * MINUTE,
      ),
      this.consumeBucket(
        'AUTH_LOGIN_FAILURE_IP',
        ipAddress || 'unknown',
        15,
        15 * MINUTE,
        15 * MINUTE,
      ),
    ]);
  }

  async recordLoginSuccess(email: string) {
    const keyHash = securityKeyHash('AUTH_LOGIN_FAILURE_EMAIL', email);
    await this.prisma.authRateLimitBucket
      .delete({
        where: {
          scope_keyHash: {
            scope: 'AUTH_LOGIN_FAILURE_EMAIL',
            keyHash,
          },
        },
      })
      .catch(() => undefined);
  }

  async assertSignupAllowed(email: string, ipAddress?: string | null) {
    await this.consumeBucket(
      'AUTH_SIGNUP_IP',
      ipAddress || 'unknown',
      10,
      HOUR,
      HOUR,
    );
    await this.consumeBucket('AUTH_SIGNUP_EMAIL', email, 2, DAY, DAY);
  }

  async assertRecoveryRequestAllowed(email: string, ipAddress?: string | null) {
    await this.consumeBucket(
      'AUTH_RECOVERY_IP',
      ipAddress || 'unknown',
      10,
      HOUR,
      HOUR,
    );
    await this.consumeBucket('AUTH_RECOVERY_EMAIL', email, 3, HOUR, HOUR);
  }

  assertPasswordPolicy(password: string) {
    const violations = passwordPolicyViolations(password);
    if (violations.length > 0) {
      throw new ConflictException(
        'Senha deve ter 12-128 caracteres com maiuscula, minuscula, numero e simbolo',
      );
    }
  }

  requireVerifiedEmail(): boolean {
    return this.config.get<string>('AUTH_REQUIRE_VERIFIED_EMAIL')?.trim() === 'true';
  }

  private ttl(kind: AuthActionTokenKind): number {
    if (kind === AuthActionTokenKind.PASSWORD_RESET) return PASSWORD_RESET_TTL_MS;
    if (kind === AuthActionTokenKind.EMAIL_CHANGE) return EMAIL_CHANGE_TTL_MS;
    return EMAIL_VERIFICATION_TTL_MS;
  }

  async issueActionToken(
    userId: string,
    kind: AuthActionTokenKind,
    targetEmail?: string | null,
    db: AuthDb = this.prisma,
  ) {
    const raw = newActionSecret();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttl(kind));

    await db.authActionToken.updateMany({
      where: { userId, kind, consumedAt: null },
      data: { consumedAt: now },
    });

    const record = await db.authActionToken.create({
      data: {
        userId,
        kind,
        tokenHash: hashOpaqueToken(raw),
        deliveryCiphertext: encryptActionSecret(this.config, raw),
        targetEmail: targetEmail ?? null,
        expiresAt,
      },
    });

    return { raw, record };
  }

  async consumeActionTokenWithTx(
    tx: Prisma.TransactionClient,
    raw: string,
    kind: AuthActionTokenKind,
  ) {
    const tokenHash = hashOpaqueToken(raw);
    const record = await tx.authActionToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !record ||
      record.kind !== kind ||
      record.consumedAt ||
      record.expiresAt <= new Date() ||
      !record.user.active
    ) {
      throw new UnauthorizedException('Token invalido ou expirado');
    }

    const consumed = await tx.authActionToken.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException('Token invalido ou expirado');
    }
    return record;
  }

  async assertStepUp(
    userId: string,
    currentPassword: string,
    mfaCode?: string,
    recoveryCode?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException('Reautenticacao invalida');
    const passwordOk = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Reautenticacao invalida');
    if (user.mfaEnabled) {
      const secondFactorOk = await this.verifySecondFactor(
        user,
        mfaCode,
        recoveryCode,
      );
      if (!secondFactorOk) throw new UnauthorizedException('Reautenticacao invalida');
    }
    return user;
  }

  async verifySecondFactor(
    user: { id: string; mfaEnabled: boolean; mfaSecret: string | null },
    mfaCode?: string,
    recoveryCode?: string,
  ): Promise<boolean> {
    if (!user.mfaEnabled) return true;

    if (mfaCode && user.mfaSecret) {
      try {
        const secret = decryptMfaSecret(this.config, user.mfaSecret);
        if (verifyTotp(secret, mfaCode)) return true;
      } catch {
        return false;
      }
    }

    if (recoveryCode) {
      const codeHash = hashOpaqueToken(recoveryCode.trim().toUpperCase());
      const consumed = await this.prisma.authRecoveryCode.updateMany({
        where: {
          userId: user.id,
          codeHash,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 1) return true;
    }

    return false;
  }

  async beginMfaEnrollment(
    userId: string,
    currentPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException('Reautenticacao invalida');
    if (user.mfaEnabled) throw new ConflictException('MFA ja habilitado');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Reautenticacao invalida');
    }

    const secret = newTotpSecret();
    await this.prisma.$transaction(async (tx) => {
      // Enrollment must never disable MFA that was confirmed concurrently.
      const claimed = await tx.user.updateMany({
        where: { id: userId, mfaEnabled: false, mfaSecret: user.mfaSecret },
        data: { mfaSecret: encryptMfaSecret(this.config, secret) },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Enrollment MFA indisponivel');
      }
      await tx.authRecoveryCode.deleteMany({ where: { userId } });
      await this.audit.record(
        {
          userId,
          action: 'AUTH_MFA_ENROLLMENT_STARTED',
          entity: 'User',
          entityId: userId,
        },
        tx,
      );
    });

    return {
      secret,
      otpauthUri: totpUri(secret, user.email, 'IRON'),
    };
  }

  async confirmMfaEnrollment(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.mfaEnabled || !user.mfaSecret) {
      throw new ConflictException('Enrollment MFA indisponivel');
    }

    const secret = decryptMfaSecret(this.config, user.mfaSecret);
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException('Codigo MFA invalido');
    }

    const rawCodes = Array.from({ length: 8 }, () => newRecoveryCode());
    await this.prisma.$transaction(async (tx) => {
      // Claim this exact enrollment before replacing recovery codes. Competing
      // confirmations (or a restarted enrollment) must fail without side effects.
      const claimed = await tx.user.updateMany({
        where: { id: userId, mfaEnabled: false, mfaSecret: user.mfaSecret },
        data: { mfaEnabled: true },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Enrollment MFA indisponivel');
      }
      await tx.authRecoveryCode.deleteMany({ where: { userId } });
      await tx.authRecoveryCode.createMany({
        data: rawCodes.map((raw) => ({
          userId,
          codeHash: hashOpaqueToken(raw),
        })),
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          userId,
          action: 'AUTH_MFA_ENABLED',
          entity: 'User',
          entityId: userId,
        },
        tx,
      );
    });

    return { enabled: true, recoveryCodes: rawCodes };
  }

  async disableMfa(
    userId: string,
    currentPassword: string,
    mfaCode?: string,
    recoveryCode?: string,
  ) {
    const user = await this.assertStepUp(
      userId,
      currentPassword,
      mfaCode,
      recoveryCode,
    );
    if (!user.mfaEnabled) return { disabled: true, idempotent: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.authRecoveryCode.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          userId,
          action: 'AUTH_MFA_DISABLED',
          entity: 'User',
          entityId: userId,
        },
        tx,
      );
    });
    return { disabled: true, idempotent: false };
  }
}
