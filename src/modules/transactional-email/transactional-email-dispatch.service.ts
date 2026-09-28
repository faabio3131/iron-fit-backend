import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthActionDeliveryStatus,
  AuthActionTokenKind,
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptActionSecret } from '../auth/auth-security';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';
import {
  TransactionalEmailDispatchFailure,
  TransactionalEmailProviderAdapterRegistry,
} from './transactional-email-provider-adapter';

const EMAIL_CAPABILITY = 'email.transactional';
const DISPATCH_INTERVAL_MS = 5_000;
const DISPATCH_LEASE_MS = 2 * 60_000;
const DISPATCH_BATCH_SIZE = 20;
const MAX_DISPATCH_ATTEMPTS = 5;

function hasCapability(raw: unknown, required: string): boolean {
  return (
    Array.isArray(raw) &&
    raw.some(
      (value) =>
        typeof value === 'string' &&
        value.trim().toLowerCase() === required,
    )
  );
}

function retryBackoffMs(attempt: number): number {
  const schedule = [
    30_000,
    2 * 60_000,
    10 * 60_000,
    30 * 60_000,
    2 * 60 * 60_000,
  ];
  return schedule[
    Math.min(Math.max(attempt - 1, 0), schedule.length - 1)
  ];
}

function safeFailureCode(error: unknown): string {
  if (error instanceof TransactionalEmailDispatchFailure) {
    return error.code.slice(0, 96);
  }
  return 'EMAIL_DELIVERY_UNAVAILABLE';
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

@Injectable()
export class TransactionalEmailDispatchService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private cycleRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly adapters: TransactionalEmailProviderAdapterRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (
      this.config
        .get<string>('TRANSACTIONAL_EMAIL_DISPATCH_ENABLED')
        ?.trim()
        .toLowerCase() !== 'true'
    ) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runCycle().catch(() => undefined);
    }, DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private actionUrl(kind: AuthActionTokenKind, rawToken: string): string {
    const rawBase = this.config.get<string>('WEB_APP_URL')?.trim();
    if (!rawBase) {
      throw new TransactionalEmailDispatchFailure(
        'EMAIL_PUBLIC_URL_MISSING',
      );
    }
    let base: URL;
    try {
      base = new URL(rawBase);
    } catch {
      throw new TransactionalEmailDispatchFailure(
        'EMAIL_PUBLIC_URL_INVALID',
      );
    }
    if (base.protocol !== 'https:') {
      throw new TransactionalEmailDispatchFailure(
        'EMAIL_PUBLIC_URL_REQUIRES_HTTPS',
      );
    }

    const action = new URL('/auth/action', base);
    action.searchParams.set('kind', kind);
    action.searchParams.set('token', rawToken);
    return action.toString();
  }

  private render(
    kind: AuthActionTokenKind,
    rawToken: string,
  ): { subject: string; textBody: string; htmlBody: string } {
    const actionUrl = this.actionUrl(kind, rawToken);
    const copy =
      kind === AuthActionTokenKind.PASSWORD_RESET
        ? {
            subject: 'Redefina sua senha do IRON',
            intro: 'Foi solicitada a redefinicao da sua senha do IRON.',
            cta: 'Redefinir senha',
          }
        : kind === AuthActionTokenKind.EMAIL_CHANGE
          ? {
              subject: 'Confirme a alteracao do seu e-mail no IRON',
              intro: 'Confirme o novo e-mail associado a sua conta IRON.',
              cta: 'Confirmar novo e-mail',
            }
          : {
              subject: 'Confirme seu e-mail no IRON',
              intro: 'Confirme seu e-mail para concluir a seguranca da sua conta IRON.',
              cta: 'Confirmar e-mail',
            };

    const textBody =
      copy.intro +
      '\n\n' +
      copy.cta +
      ': ' +
      actionUrl +
      '\n\nSe voce nao iniciou esta acao, ignore esta mensagem.';

    const safeUrl = escapeHtml(actionUrl);
    const htmlBody =
      '<p>' +
      escapeHtml(copy.intro) +
      '</p><p><a href="' +
      safeUrl +
      '">' +
      escapeHtml(copy.cta) +
      '</a></p><p>Se voce nao iniciou esta acao, ignore esta mensagem.</p>';

    return { subject: copy.subject, textBody, htmlBody };
  }

  private async resolveGlobalEmailConnection() {
    const environment =
      this.runtime.current() as IntegrationEnvironment;
    const candidates = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.GLOBAL,
        gymId: null,
        environment,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
        OR: [
          { secretExpiresAt: null },
          { secretExpiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    const capable = candidates.filter((candidate) =>
      hasCapability(candidate.capabilities, EMAIL_CAPABILITY),
    );
    if (capable.length !== 1) {
      throw new TransactionalEmailDispatchFailure(
        capable.length === 0
          ? 'EMAIL_PROVIDER_CONNECTION_MISSING'
          : 'EMAIL_PROVIDER_CONNECTION_AMBIGUOUS',
      );
    }
    return capable[0];
  }

  private recipient(row: {
    kind: AuthActionTokenKind;
    targetEmail: string | null;
    user: { email: string; active: boolean };
  }): string {
    if (!row.user.active) {
      throw new TransactionalEmailDispatchFailure(
        'EMAIL_TARGET_USER_INACTIVE',
      );
    }
    const raw =
      row.kind === AuthActionTokenKind.EMAIL_CHANGE
        ? row.targetEmail
        : row.user.email;
    const normalized = raw?.trim().toLowerCase() ?? '';
    if (
      normalized.length < 3 ||
      normalized.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ) {
      throw new TransactionalEmailDispatchFailure(
        'EMAIL_RECIPIENT_INVALID',
      );
    }
    return normalized;
  }

  private async dispatchOne(row: any) {
    const now = new Date();
    const leaseOwner = randomUUID();
    const leaseUntil = new Date(now.getTime() + DISPATCH_LEASE_MS);
    const claimed = await this.prisma.authActionToken.updateMany({
      where: {
        id: row.id,
        deliveryStatus: AuthActionDeliveryStatus.PENDING,
        consumedAt: null,
        expiresAt: { gt: now },
        AND: [
          {
            OR: [
              { deliveryNextAttemptAt: null },
              { deliveryNextAttemptAt: { lte: now } },
            ],
          },
          {
            OR: [
              { deliveryLeaseUntil: null },
              { deliveryLeaseUntil: { lte: now } },
            ],
          },
        ],
      },
      data: {
        deliveryLeaseOwner: leaseOwner,
        deliveryLeaseUntil: leaseUntil,
        deliveryLastAttemptAt: now,
        deliveryAttemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return false;

    const attempt = row.deliveryAttemptCount + 1;
    try {
      if (!row.deliveryCiphertext) {
        throw new TransactionalEmailDispatchFailure(
          'EMAIL_ACTION_SECRET_UNAVAILABLE',
        );
      }
      const rawToken = decryptActionSecret(
        this.config,
        row.deliveryCiphertext,
      );
      const recipient = this.recipient(row);
      const rendered = this.render(row.kind, rawToken);
      const connection = await this.resolveGlobalEmailConnection();
      const adapter = this.adapters.require(connection.providerCode);
      const credential = await this.secrets.resolveForExternalBoundary(
        connection.id,
        { scope: 'GLOBAL' },
      );
      const result = await adapter.dispatch({
        dispatchKey: row.id,
        recipient,
        subject: rendered.subject,
        textBody: rendered.textBody,
        htmlBody: rendered.htmlBody,
        publicConfiguration: connection.publicConfiguration,
        credential,
      });
      const providerMessageRef =
        typeof result.providerMessageRef === 'string' &&
        result.providerMessageRef.trim()
          ? result.providerMessageRef.trim().slice(0, 512)
          : null;

      const deliveredAt = new Date();
      const completed = await this.prisma.authActionToken.updateMany({
        where: {
          id: row.id,
          deliveryStatus: AuthActionDeliveryStatus.PENDING,
          deliveryLeaseOwner: leaseOwner,
        },
        data: {
          deliveryStatus: AuthActionDeliveryStatus.DELIVERED,
          deliveryCiphertext: null,
          deliveredAt,
          deliveryNextAttemptAt: null,
          deliveryLeaseOwner: null,
          deliveryLeaseUntil: null,
          deliveryProviderCode: connection.providerCode,
          deliveryConnectionId: connection.id,
          deliveryProviderMessageRef: providerMessageRef,
          deliveryErrorCode: null,
        },
      });
      if (completed.count !== 1) return false;

      await this.audit.record({
        userId: row.userId,
        action: 'AUTH_ACTION_EMAIL_DELIVERED',
        entity: 'AuthActionToken',
        entityId: row.id,
        next: {
          kind: row.kind,
          providerCode: connection.providerCode,
          connectionId: connection.id,
          providerMessageRef: providerMessageRef,
          deliveredAt,
          attempt,
        },
      });
      return true;
    } catch (error) {
      const errorCode = safeFailureCode(error);
      const terminal =
        attempt >= MAX_DISPATCH_ATTEMPTS || row.expiresAt <= new Date();
      const nextAttemptAt = terminal
        ? null
        : new Date(Date.now() + retryBackoffMs(attempt));

      await this.prisma.authActionToken.updateMany({
        where: {
          id: row.id,
          deliveryStatus: AuthActionDeliveryStatus.PENDING,
          deliveryLeaseOwner: leaseOwner,
        },
        data: {
          deliveryStatus: terminal
            ? AuthActionDeliveryStatus.FAILED
            : AuthActionDeliveryStatus.PENDING,
          deliveryCiphertext: terminal ? null : row.deliveryCiphertext,
          deliveryNextAttemptAt: nextAttemptAt,
          deliveryLeaseOwner: null,
          deliveryLeaseUntil: null,
          deliveryErrorCode: errorCode,
        },
      });

      await this.audit
        .record({
          userId: row.userId,
          action: terminal
            ? 'AUTH_ACTION_EMAIL_DELIVERY_FAILED'
            : 'AUTH_ACTION_EMAIL_RETRY_SCHEDULED',
          entity: 'AuthActionToken',
          entityId: row.id,
          next: {
            kind: row.kind,
            attempt,
            errorCode,
            nextAttemptAt,
          },
        })
        .catch(() => undefined);

      return false;
    }
  }

  async dispatchDue(limit = DISPATCH_BATCH_SIZE) {
    const now = new Date();
    await this.prisma.authActionToken.updateMany({
      where: {
        deliveryStatus: AuthActionDeliveryStatus.PENDING,
        consumedAt: null,
        expiresAt: { lte: now },
      },
      data: {
        deliveryStatus: AuthActionDeliveryStatus.FAILED,
        deliveryCiphertext: null,
        deliveryNextAttemptAt: null,
        deliveryLeaseOwner: null,
        deliveryLeaseUntil: null,
        deliveryErrorCode: 'EMAIL_ACTION_EXPIRED',
      },
    });

    const rows = await this.prisma.authActionToken.findMany({
      where: {
        deliveryStatus: AuthActionDeliveryStatus.PENDING,
        consumedAt: null,
        expiresAt: { gt: now },
        AND: [
          {
            OR: [
              { deliveryNextAttemptAt: null },
              { deliveryNextAttemptAt: { lte: now } },
            ],
          },
          {
            OR: [
              { deliveryLeaseUntil: null },
              { deliveryLeaseUntil: { lte: now } },
            ],
          },
        ],
      },
      include: {
        user: { select: { email: true, active: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    let delivered = 0;
    for (const row of rows) {
      if (await this.dispatchOne(row)) delivered += 1;
    }
    return { scanned: rows.length, delivered };
  }

  async runCycle() {
    if (this.cycleRunning) return;
    this.cycleRunning = true;
    try {
      await this.dispatchDue();
    } finally {
      this.cycleRunning = false;
    }
  }
}
