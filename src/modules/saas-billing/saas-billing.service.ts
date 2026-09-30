import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProductPlanVersionStatus,
  SaasBillingAgreementStatus,
  SaasBillingInterval,
  SaasCheckoutStatus,
  SaasInvoiceStatus,
  SaasPaymentStatus,
  SaasReconciliationStatus,
  SaasRefundStatus,
  SaasWebhookStatus,
  TenantProductSubscriptionStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommercialLaunchService } from '../commercial-launch/commercial-launch.service';
import { TenantProductSubscriptionLifecycleService } from '../product-entitlements/tenant-product-subscription-lifecycle.service';
import { InternalSandboxBillingAdapter } from './adapters/internal-sandbox-billing.adapter';
import { billingPayloadHash } from './contracts/saas-billing-provider.port';
import {
  ResolvedSaasBillingProvider,
  SaasBillingProviderConnectionService,
} from './saas-billing-provider-connection.service';
import {
  BillingWebhookDto,
  CancelSaasBillingDto,
  ChangeSaasPlanDto,
  CreateSaasCheckoutDto,
  CreateSaasPriceDto,
  RefundSaasBillingDto,
  RunSaasBillingDto,
} from './dto/saas-billing.dto';

const SERIALIZABLE_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

type BillingDb = Prisma.TransactionClient | PrismaService;

@Injectable()
export class SaasBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly launch: CommercialLaunchService,
    private readonly audit: AuditService,
    private readonly lifecycle: TenantProductSubscriptionLifecycleService,
    private readonly sandbox: InternalSandboxBillingAdapter,
    @Optional()
    private readonly providerConnections?: SaasBillingProviderConnectionService,
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
    throw new ConflictException('Falha de concorrencia no billing SaaS');
  }

  private requireGymId(gymId?: string | null): string {
    if (!gymId?.trim()) {
      throw new BadRequestException('Tenant ativo obrigatorio para billing SaaS');
    }
    return gymId;
  }

  private async provider(
    expectedCode?: string,
  ): Promise<ResolvedSaasBillingProvider> {
    if (this.providerConnections) {
      return this.providerConnections.resolve(expectedCode);
    }

    // Backward-compatible internal test fallback. Production/runtime wiring
    // always injects SaasBillingProviderConnectionService.
    const configured = this.config.get<string>('SAAS_BILLING_PROVIDER')?.trim();
    if (!configured) {
      throw new ServiceUnavailableException(
        'Provider SaaS billing nao configurado/homologado',
      );
    }
    if (
      expectedCode &&
      expectedCode.toLowerCase() !== configured.toLowerCase()
    ) {
      throw new BadRequestException('Provider SaaS billing nao autorizado');
    }
    if (configured !== this.sandbox.code) {
      throw new ServiceUnavailableException(
        'Provider SaaS billing configurado ainda nao possui adapter homologado',
      );
    }
    this.sandbox.assertAvailable();
    return {
      code: this.sandbox.code,
      adapter: this.sandbox,
      context: {
        connectionId: null,
        publicConfiguration: null,
        credential: null,
      },
      connectionId: null,
      sandboxOnly: true,
    };
  }

  private async approvedCommercialPolicy() {
    const approved = await this.launch.currentApproved();
    const policy = approved.policy;
    if (
      !policy ||
      !Number.isInteger(policy.invoiceDueDays) ||
      (policy.invoiceDueDays ?? -1) < 0 ||
      (policy.invoiceDueDays ?? 31) > 30 ||
      !Number.isInteger(policy.dunningGraceDays) ||
      (policy.dunningGraceDays ?? 0) < 1 ||
      (policy.dunningGraceDays ?? 31) > 30
    ) {
      throw new ServiceUnavailableException(
        'Politica comercial da Launch Matrix APPROVED incompleta',
      );
    }
    return policy;
  }

  private periodEnd(start: Date, interval: SaasBillingInterval): Date {
    const end = new Date(start);
    if (interval === SaasBillingInterval.MONTHLY) {
      end.setUTCMonth(end.getUTCMonth() + 1);
    } else {
      end.setUTCFullYear(end.getUTCFullYear() + 1);
    }
    return end;
  }

  private async priceByCode(
    db: BillingDb,
    priceCode: string,
    at = new Date(),
  ) {
    const price = await db.saasPlanPrice.findUnique({
      where: { priceCode },
      include: {
        planVersion: { include: { productPlan: true } },
      },
    });
    if (
      !price ||
      !price.active ||
      price.effectiveFrom > at ||
      (price.effectiveUntil && price.effectiveUntil <= at)
    ) {
      throw new NotFoundException('Preco SaaS ativo nao encontrado');
    }
    if (price.planVersion.status !== ProductPlanVersionStatus.PUBLISHED) {
      throw new ConflictException('Preco SaaS aponta para versao de plano nao publicada');
    }
    return price;
  }

  private async activeProductSubscription(db: BillingDb, gymId: string) {
    return db.tenantProductSubscription.findFirst({
      where: {
        gymId,
        status: TenantProductSubscriptionStatus.ACTIVE,
        effectiveFrom: { lte: new Date() },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: new Date() } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { planVersion: { include: { productPlan: true } } },
    });
  }

  private async liveAgreement(db: BillingDb, gymId: string) {
    return db.saasBillingAgreement.findFirst({
      where: {
        gymId,
        status: { not: SaasBillingAgreementStatus.CANCELED },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        price: {
          include: { planVersion: { include: { productPlan: true } } },
        },
        productSubscription: {
          include: { planVersion: { include: { productPlan: true } } },
        },
      },
    });
  }

  private samePrice(existing: any, dto: CreateSaasPriceDto): boolean {
    return (
      existing.priceCode === dto.priceCode &&
      existing.currency === dto.currency &&
      existing.amountMinor === dto.amountMinor &&
      existing.interval === dto.interval &&
      existing.planVersion?.version === dto.version &&
      existing.planVersion?.productPlan?.code === dto.planCode
    );
  }

  async createPrice(dto: CreateSaasPriceDto, actorUserId?: string) {
    return this.serializable(async (tx) => {
      const existing = await tx.saasPlanPrice.findUnique({
        where: { priceCode: dto.priceCode },
        include: { planVersion: { include: { productPlan: true } } },
      });
      if (existing) {
        if (!this.samePrice(existing, dto)) {
          throw new ConflictException('priceCode SaaS ja existe com outra definicao');
        }
        return { ...existing, idempotent: true };
      }

      const version = await tx.productPlanVersion.findFirst({
        where: {
          version: dto.version,
          productPlan: { code: dto.planCode },
        },
        include: { productPlan: true },
      });
      if (!version) throw new NotFoundException('ProductPlanVersion nao encontrada');
      if (version.status !== ProductPlanVersionStatus.PUBLISHED) {
        throw new ConflictException('Somente ProductPlanVersion PUBLISHED pode receber preco');
      }

      const price = await tx.saasPlanPrice.create({
        data: {
          priceCode: dto.priceCode,
          planVersionId: version.id,
          currency: dto.currency,
          amountMinor: dto.amountMinor,
          interval: dto.interval as SaasBillingInterval,
        },
        include: { planVersion: { include: { productPlan: true } } },
      });

      await this.audit.record(
        {
          userId: actorUserId ?? null,
          action: 'SAAS_PRICE_CREATED',
          entity: 'SaasPlanPrice',
          entityId: price.id,
          next: {
            priceCode: price.priceCode,
            planCode: version.productPlan.code,
            version: version.version,
            currency: price.currency,
            amountMinor: price.amountMinor,
            interval: price.interval,
          },
        },
        tx,
      );

      return { ...price, idempotent: false };
    });
  }

  async listPrices() {
    const now = new Date();
    return this.prisma.saasPlanPrice.findMany({
      where: {
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        planVersion: { status: ProductPlanVersionStatus.PUBLISHED },
      },
      orderBy: [{ amountMinor: 'asc' }, { priceCode: 'asc' }],
      include: { planVersion: { include: { productPlan: true } } },
    });
  }

  async getCurrent(gymId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const agreement = await this.liveAgreement(this.prisma, scopedGymId);
    if (!agreement) {
      return { agreement: null, invoices: [], billingPolicy: null };
    }

    const [invoices, commercialPolicy] = await Promise.all([
      this.prisma.saasInvoice.findMany({
        where: { agreementId: agreement.id },
        orderBy: { createdAt: 'desc' },
        take: 24,
        include: { payments: true, refunds: true, price: true },
      }),
      this.approvedCommercialPolicy(),
    ]);

    const dunningGraceDays = commercialPolicy.dunningGraceDays as number;
    const gracePeriodEndsAt = agreement.pastDueSince
      ? new Date(
          agreement.pastDueSince.getTime() +
            dunningGraceDays * DAY_MS,
        )
      : null;

    return {
      agreement,
      invoices,
      billingPolicy: {
        invoiceDueDays: commercialPolicy.invoiceDueDays as number,
        dunningGraceDays,
        gracePeriodEndsAt,
      },
    };
  }

  private async prepareCheckout(
    gymId: string,
    actorUserId: string | undefined,
    dto: CreateSaasCheckoutDto,
    amountOverride?: number,
  ) {
    const provider = await this.provider();

    const prepared = await this.serializable(async (tx) => {
      const replay = await tx.saasCheckoutSession.findUnique({
        where: { requestId: dto.requestId },
        include: { price: true, agreement: true },
      });
      if (replay) {
        if (replay.gymId !== gymId || replay.price.priceCode !== dto.priceCode) {
          throw new ConflictException(
            'requestId de checkout reutilizado com dados diferentes',
          );
        }
        return { checkout: replay, replay: true };
      }

      const price = await this.priceByCode(tx, dto.priceCode);
      const current = await this.activeProductSubscription(tx, gymId);
      if (!current) {
        throw new ConflictException(
          'Tenant sem assinatura SaaS ACTIVE; checkout nao pode conceder acesso',
        );
      }

      let agreement = await this.liveAgreement(tx, gymId);
      if (!agreement) {
        agreement = await tx.saasBillingAgreement.create({
          data: {
            gymId,
            tenantProductSubscriptionId: current.id,
            status: SaasBillingAgreementStatus.PENDING_CHECKOUT,
            providerCode: provider.code,
          },
          include: {
            price: {
              include: { planVersion: { include: { productPlan: true } } },
            },
            productSubscription: {
              include: { planVersion: { include: { productPlan: true } } },
            },
          },
        });
      } else {
        if (agreement.providerCode !== provider.code) {
          throw new ConflictException(
            'Billing agreement pertence a outro provider',
          );
        }
        if (agreement.tenantProductSubscriptionId !== current.id) {
          throw new ConflictException(
            'Billing agreement esta dessincronizado da assinatura SaaS canônica',
          );
        }
      }

      const amountMinor = amountOverride ?? price.amountMinor;
      if (!Number.isInteger(amountMinor) || amountMinor < 0) {
        throw new BadRequestException('Valor de checkout SaaS invalido');
      }

      const checkout = await tx.saasCheckoutSession.create({
        data: {
          requestId: dto.requestId,
          gymId,
          agreementId: agreement.id,
          priceId: price.id,
          providerCode: provider.code,
          status: SaasCheckoutStatus.PENDING,
          amountMinor,
          currency: price.currency,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
        include: { price: true, agreement: true },
      });

      await this.audit.record(
        {
          gymId,
          userId: actorUserId ?? null,
          action: 'SAAS_CHECKOUT_INITIATED',
          entity: 'SaasCheckoutSession',
          entityId: checkout.id,
          next: {
            requestId: checkout.requestId,
            priceCode: price.priceCode,
            amountMinor: checkout.amountMinor,
            currency: checkout.currency,
            providerCode: checkout.providerCode,
          },
        },
        tx,
      );

      return { checkout, replay: false };
    });

    if (
      prepared.checkout.status !== SaasCheckoutStatus.PENDING &&
      prepared.checkout.providerSessionRef
    ) {
      return {
        ...prepared.checkout,
        idempotent: true,
        checkoutUrl: prepared.checkout.checkoutUrl ?? null,
        sandboxOnly: provider.sandboxOnly,
      };
    }

    const providerResult = await provider.adapter.createCheckout({
      requestId: prepared.checkout.requestId,
      gymId,
      agreementId: prepared.checkout.agreementId,
      priceCode: prepared.checkout.price.priceCode,
      amountMinor: prepared.checkout.amountMinor,
      currency: prepared.checkout.currency,
    }, provider.context);

    return this.serializable(async (tx) => {
      const current = await tx.saasCheckoutSession.findUnique({
        where: { id: prepared.checkout.id },
      });
      if (!current) throw new NotFoundException('Checkout SaaS nao encontrado');

      if (
        current.providerSessionRef &&
        current.providerSessionRef !== providerResult.providerSessionRef
      ) {
        throw new ConflictException(
          'Provider retornou referencia divergente para o mesmo checkout',
        );
      }

      const checkout = await tx.saasCheckoutSession.update({
        where: { id: current.id },
        data: {
          providerSessionRef: providerResult.providerSessionRef,
          checkoutUrl: providerResult.checkoutUrl,
          expiresAt: providerResult.expiresAt,
          status: SaasCheckoutStatus.READY,
        },
        include: { price: true, agreement: true },
      });

      await this.audit.record(
        {
          gymId,
          userId: actorUserId ?? null,
          action: 'SAAS_CHECKOUT_READY',
          entity: 'SaasCheckoutSession',
          entityId: checkout.id,
          next: {
            providerCode: checkout.providerCode,
            providerSessionRef: checkout.providerSessionRef,
            expiresAt: checkout.expiresAt,
          },
        },
        tx,
      );

      return {
        ...checkout,
        idempotent: prepared.replay,
        checkoutUrl: checkout.checkoutUrl ?? null,
        sandboxOnly: checkout.providerCode === this.sandbox.code,
      };
    });
  }

  async createCheckout(
    gymId: string | undefined,
    actorUserId: string | undefined,
    dto: CreateSaasCheckoutDto,
  ) {
    return this.prepareCheckout(this.requireGymId(gymId), actorUserId, dto);
  }

  private proratedUpgradeAmount(
    currentAmount: number,
    targetAmount: number,
    start: Date | null,
    end: Date | null,
    at = new Date(),
  ): number {
    if (!start || !end || end <= at || end <= start) return targetAmount;
    const full = end.getTime() - start.getTime();
    const remaining = Math.max(0, end.getTime() - at.getTime());
    const ratio = Math.min(1, remaining / full);
    const currentCredit = Math.floor(currentAmount * ratio);
    const targetCost = Math.floor(targetAmount * ratio);
    return Math.max(1, targetCost - currentCredit);
  }

  async changePlan(
    gymId: string | undefined,
    actorUserId: string | undefined,
    dto: ChangeSaasPlanDto,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const snapshot = await this.liveAgreement(this.prisma, scopedGymId);
    if (
      !snapshot ||
      snapshot.status !== SaasBillingAgreementStatus.ACTIVE ||
      !snapshot.price
    ) {
      throw new ConflictException('Billing SaaS ACTIVE obrigatorio para troca de plano');
    }

    const target = await this.priceByCode(this.prisma, dto.priceCode);
    if (target.id === snapshot.price.id) {
      return { changed: false, idempotent: true, agreement: snapshot };
    }
    if (target.interval !== snapshot.price.interval) {
      throw new ConflictException(
        'Mudanca de intervalo exige operacao comercial administrativa dedicada',
      );
    }

    if (dto.transitionKind === 'UPGRADE') {
      if (target.amountMinor <= snapshot.price.amountMinor) {
        throw new ConflictException('UPGRADE exige preco alvo superior ao atual');
      }
      const amountMinor = this.proratedUpgradeAmount(
        snapshot.price.amountMinor,
        target.amountMinor,
        snapshot.currentPeriodStart,
        snapshot.currentPeriodEnd,
      );
      const checkout = await this.prepareCheckout(
        scopedGymId,
        actorUserId,
        dto,
        amountMinor,
      );
      return {
        changed: true,
        transitionKind: dto.transitionKind,
        proration: {
          policy: 'IMMEDIATE_REMAINING_PERIOD_DELTA',
          amountMinor,
          currency: target.currency,
        },
        checkout,
      };
    }

    if (target.amountMinor >= snapshot.price.amountMinor) {
      throw new ConflictException('DOWNGRADE exige preco alvo inferior ao atual');
    }
    if (!snapshot.currentPeriodEnd) {
      throw new ConflictException('DOWNGRADE exige periodo corrente materializado');
    }

    return this.serializable(async (tx) => {
      const agreement = await this.liveAgreement(tx, scopedGymId);
      if (!agreement || agreement.id !== snapshot.id) {
        throw new ConflictException('Billing agreement mudou; recarregue o estado');
      }
      const pending = agreement.pendingTransition as any;
      if (pending?.requestId) {
        if (
          pending.requestId === dto.requestId &&
          pending.priceCode === dto.priceCode &&
          pending.transitionKind === dto.transitionKind
        ) {
          return {
            changed: false,
            idempotent: true,
            scheduledFor: pending.effectiveAt,
            agreement,
          };
        }
        throw new ConflictException('Ja existe transicao de plano pendente');
      }

      const effectiveAt = snapshot.currentPeriodEnd!;
      const updated = await tx.saasBillingAgreement.update({
        where: { id: agreement.id },
        data: {
          pendingTransition: {
            requestId: dto.requestId,
            priceCode: dto.priceCode,
            transitionKind: dto.transitionKind,
            reason: dto.reason,
            effectiveAt: effectiveAt.toISOString(),
          },
        },
      });

      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: actorUserId ?? null,
          action: 'SAAS_PLAN_CHANGE_SCHEDULED',
          entity: 'SaasBillingAgreement',
          entityId: updated.id,
          next: {
            transitionKind: dto.transitionKind,
            priceCode: dto.priceCode,
            effectiveAt,
            prorationPolicy: 'NO_IMMEDIATE_REFUND_EFFECTIVE_NEXT_PERIOD',
          },
        },
        tx,
      );

      return {
        changed: true,
        idempotent: false,
        scheduledFor: effectiveAt,
        proration: {
          policy: 'NO_IMMEDIATE_REFUND_EFFECTIVE_NEXT_PERIOD',
          amountMinor: 0,
          currency: target.currency,
        },
        agreement: updated,
      };
    });
  }

  async cancel(
    gymId: string | undefined,
    actorUserId: string | undefined,
    dto: CancelSaasBillingDto,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    return this.serializable(async (tx) => {
      const agreement = await this.liveAgreement(tx, scopedGymId);
      if (!agreement) return { changed: false, idempotent: true };

      if (dto.atPeriodEnd === true) {
        if (agreement.cancelAtPeriodEnd) {
          return { changed: false, idempotent: true, agreement };
        }
        const updated = await tx.saasBillingAgreement.update({
          where: { id: agreement.id },
          data: { cancelAtPeriodEnd: true },
        });
        await this.audit.record(
          {
            gymId: scopedGymId,
            userId: actorUserId ?? null,
            action: 'SAAS_BILLING_CANCEL_SCHEDULED',
            entity: 'SaasBillingAgreement',
            entityId: updated.id,
            next: { effectiveAt: agreement.currentPeriodEnd ?? agreement.nextBillingAt },
          },
          tx,
        );
        return { changed: true, idempotent: false, agreement: updated };
      }

      const subscription = await tx.tenantProductSubscription.findUnique({
        where: { id: agreement.tenantProductSubscriptionId },
      });
      if (subscription && subscription.status !== TenantProductSubscriptionStatus.CANCELED) {
        const now = new Date();
        const minimumEnd = new Date(subscription.effectiveFrom.getTime() + 1);
        await tx.tenantProductSubscription.update({
          where: { id: subscription.id },
          data: {
            status: TenantProductSubscriptionStatus.CANCELED,
            effectiveUntil: now > minimumEnd ? now : minimumEnd,
          },
        });
      }
      const updated = await tx.saasBillingAgreement.update({
        where: { id: agreement.id },
        data: {
          status: SaasBillingAgreementStatus.CANCELED,
          canceledAt: new Date(),
          cancelAtPeriodEnd: false,
          pendingTransition: Prisma.DbNull,
        },
      });
      await tx.saasCheckoutSession.updateMany({
        where: {
          agreementId: agreement.id,
          status: { in: [SaasCheckoutStatus.PENDING, SaasCheckoutStatus.READY] },
        },
        data: { status: SaasCheckoutStatus.CANCELED },
      });

      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: actorUserId ?? null,
          action: 'SAAS_BILLING_CANCELED',
          entity: 'SaasBillingAgreement',
          entityId: updated.id,
          next: { immediate: true, productSubscriptionId: agreement.tenantProductSubscriptionId },
        },
        tx,
      );
      return { changed: true, idempotent: false, agreement: updated };
    });
  }

  private requiredText(data: Record<string, unknown>, key: string): string {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`Webhook billing exige ${key}`);
    }
    return value.trim();
  }

  private optionalText(data: Record<string, unknown>, key: string): string | null {
    const value = data[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private requiredPositiveInt(data: Record<string, unknown>, key: string): number {
    const value = data[key];
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new BadRequestException(`Webhook billing exige ${key} inteiro positivo`);
    }
    return value as number;
  }

  private optionalDate(
    data: Record<string, unknown>,
    key: string,
    fallback?: Date,
  ): Date | null {
    const value = data[key];
    if (value === undefined || value === null || value === '') return fallback ?? null;
    if (typeof value !== 'string') {
      throw new BadRequestException(`Webhook billing possui ${key} invalido`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Webhook billing possui ${key} invalido`);
    }
    return parsed;
  }

  private async invoiceForWebhook(
    tx: Prisma.TransactionClient,
    providerCode: string,
    dto: BillingWebhookDto,
  ) {
    const data = dto.data;
    const invoiceId = this.optionalText(data, 'invoiceId');
    const providerInvoiceRef = this.optionalText(data, 'providerInvoiceRef');

    let invoice: any = null;
    if (invoiceId) {
      invoice = await tx.saasInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          price: { include: { planVersion: { include: { productPlan: true } } } },
          agreement: true,
          payments: true,
          refunds: true,
        },
      });
    } else if (providerInvoiceRef) {
      invoice = await tx.saasInvoice.findUnique({
        where: {
          providerCode_providerInvoiceRef: {
            providerCode,
            providerInvoiceRef,
          },
        },
        include: {
          price: { include: { planVersion: { include: { productPlan: true } } } },
          agreement: true,
          payments: true,
          refunds: true,
        },
      });
    }

    let checkout: any = null;
    if (!invoice) {
      const providerSessionRef = this.requiredText(data, 'providerSessionRef');
      checkout = await tx.saasCheckoutSession.findUnique({
        where: {
          providerCode_providerSessionRef: {
            providerCode,
            providerSessionRef,
          },
        },
        include: {
          price: { include: { planVersion: { include: { productPlan: true } } } },
          agreement: true,
        },
      });
      if (!checkout) throw new NotFoundException('Checkout SaaS do webhook nao encontrado');

      const amountMinor = this.requiredPositiveInt(data, 'amountMinor');
      const currency = this.requiredText(data, 'currency');
      if (
        amountMinor !== checkout.amountMinor ||
        currency !== checkout.currency
      ) {
        throw new ConflictException('Valor/moeda do webhook diverge do checkout');
      }

      const invoiceRef = providerInvoiceRef ?? this.requiredText(data, 'providerInvoiceRef');
      const occurredAt = new Date(dto.occurredAt);
      const periodStart = this.optionalDate(data, 'periodStart', occurredAt)!;
      const periodEnd = this.optionalDate(
        data,
        'periodEnd',
        this.periodEnd(periodStart, checkout.price.interval),
      )!;
      if (periodEnd <= periodStart) {
        throw new BadRequestException('Periodo de invoice SaaS invalido');
      }

      invoice = await tx.saasInvoice.create({
        data: {
          idempotencyKey: `provider:${providerCode}:invoice:${invoiceRef}`,
          agreementId: checkout.agreementId,
          gymId: checkout.gymId,
          priceId: checkout.priceId,
          providerCode,
          providerInvoiceRef: invoiceRef,
          periodStart,
          periodEnd,
          amountDueMinor: checkout.amountMinor,
          currency: checkout.currency,
          dueAt: periodStart,
        },
        include: {
          price: { include: { planVersion: { include: { productPlan: true } } } },
          agreement: true,
          payments: true,
          refunds: true,
        },
      });
    }

    if (!invoice || invoice.providerCode !== providerCode) {
      throw new ConflictException('Invoice SaaS nao pertence ao provider do webhook');
    }
    return { invoice, checkout };
  }

  private async canonicalSubscriptionForAgreement(
    tx: Prisma.TransactionClient,
    agreement: any,
  ) {
    const subscription = await tx.tenantProductSubscription.findUnique({
      where: { id: agreement.tenantProductSubscriptionId },
      include: { planVersion: { include: { productPlan: true } } },
    });
    if (!subscription) {
      throw new ConflictException('Assinatura SaaS canônica do billing nao existe');
    }
    const otherActive = await tx.tenantProductSubscription.findFirst({
      where: {
        gymId: agreement.gymId,
        status: TenantProductSubscriptionStatus.ACTIVE,
        id: { not: subscription.id },
      },
    });
    if (otherActive) {
      throw new ConflictException(
        'Billing agreement dessincronizado: existe outra assinatura SaaS ACTIVE',
      );
    }
    if (subscription.status === TenantProductSubscriptionStatus.CANCELED) {
      throw new ConflictException('Assinatura SaaS canônica cancelada nao pode ser reativada por webhook');
    }
    return subscription;
  }

  private fiscalHandoff(invoice: any) {
    return {
      source: 'IRON_SAAS_BILLING',
      status: 'PENDING_CAPABILITY',
      gymId: invoice.gymId,
      invoiceId: invoice.id,
      amountPaidMinor: invoice.amountPaidMinor,
      currency: invoice.currency,
      paidAt: invoice.paidAt,
    };
  }

  private async handleInvoicePaid(
    tx: Prisma.TransactionClient,
    providerCode: string,
    dto: BillingWebhookDto,
  ) {
    const { invoice, checkout } = await this.invoiceForWebhook(tx, providerCode, dto);
    const data = dto.data;
    const providerPaymentRef = this.requiredText(data, 'providerPaymentRef');
    const amountMinor = this.requiredPositiveInt(data, 'amountMinor');
    const currency = this.requiredText(data, 'currency');
    if (amountMinor !== invoice.amountDueMinor || currency !== invoice.currency) {
      throw new ConflictException('Pagamento nao corresponde integralmente ao invoice SaaS');
    }

    const existingPayment = await tx.saasPayment.findUnique({
      where: {
        providerCode_providerPaymentRef: { providerCode, providerPaymentRef },
      },
    });
    if (
      existingPayment &&
      (existingPayment.invoiceId !== invoice.id ||
        existingPayment.amountMinor !== amountMinor ||
        existingPayment.currency !== currency)
    ) {
      throw new ConflictException('Referencia de pagamento reutilizada com dados divergentes');
    }
    if (!existingPayment) {
      await tx.saasPayment.create({
        data: {
          invoiceId: invoice.id,
          providerCode,
          providerPaymentRef,
          amountMinor,
          currency,
          status: SaasPaymentStatus.SUCCEEDED,
          paidAt: new Date(dto.occurredAt),
        },
      });
    }

    const paidInvoice = await tx.saasInvoice.update({
      where: { id: invoice.id },
      data: {
        status: SaasInvoiceStatus.PAID,
        amountPaidMinor: amountMinor,
        paidAt: new Date(dto.occurredAt),
      },
      include: {
        price: { include: { planVersion: { include: { productPlan: true } } } },
      },
    });

    const agreement = await tx.saasBillingAgreement.findUnique({
      where: { id: invoice.agreementId },
    });
    if (!agreement || agreement.status === SaasBillingAgreementStatus.CANCELED) {
      throw new ConflictException('Billing agreement nao pode receber pagamento');
    }

    let canonical = await this.canonicalSubscriptionForAgreement(tx, agreement);
    if (canonical.status === TenantProductSubscriptionStatus.SUSPENDED) {
      canonical = await tx.tenantProductSubscription.update({
        where: { id: canonical.id },
        data: { status: TenantProductSubscriptionStatus.ACTIVE },
        include: { planVersion: { include: { productPlan: true } } },
      });
    }

    let nextSubscriptionId = canonical.id;
    if (canonical.planVersionId !== paidInvoice.price.planVersionId) {
      const pending = agreement.pendingTransition as any;
      const transition = await this.lifecycle.transitionWithTx(
        tx,
        {
          gymId: agreement.gymId,
          expectedCurrentSubscriptionId: canonical.id,
          planCode: paidInvoice.price.planVersion.productPlan.code,
          version: paidInvoice.price.planVersion.version,
          transitionKind:
            pending?.transitionKind === 'UPGRADE' ||
            pending?.transitionKind === 'DOWNGRADE'
              ? pending.transitionKind
              : 'PLAN_CHANGE',
          reason:
            typeof pending?.reason === 'string'
              ? pending.reason
              : 'Pagamento SaaS confirmado',
        },
        undefined,
      );
      nextSubscriptionId = transition.subscription.id;
    }

    const providerSubscriptionRef =
      this.optionalText(data, 'providerSubscriptionRef') ??
      agreement.providerSubscriptionRef;

    const updatedAgreement = await tx.saasBillingAgreement.update({
      where: { id: agreement.id },
      data: {
        tenantProductSubscriptionId: nextSubscriptionId,
        priceId: paidInvoice.priceId,
        status: SaasBillingAgreementStatus.ACTIVE,
        providerSubscriptionRef,
        currentPeriodStart: paidInvoice.periodStart,
        currentPeriodEnd: paidInvoice.periodEnd,
        nextBillingAt: paidInvoice.periodEnd,
        pastDueSince: null,
        pendingTransition: Prisma.DbNull,
      },
    });

    if (checkout) {
      await tx.saasCheckoutSession.update({
        where: { id: checkout.id },
        data: { status: SaasCheckoutStatus.COMPLETED },
      });
    }

    await this.audit.record(
      {
        gymId: agreement.gymId,
        action: 'SAAS_INVOICE_PAID',
        entity: 'SaasInvoice',
        entityId: paidInvoice.id,
        next: {
          providerCode,
          providerPaymentRef,
          amountMinor,
          currency,
          priceCode: paidInvoice.price.priceCode,
          productSubscriptionId: nextSubscriptionId,
        },
      },
      tx,
    );
    await this.audit.record(
      {
        gymId: agreement.gymId,
        action: 'SAAS_BILLING_FISCAL_HANDOFF_PENDING_CAPABILITY',
        entity: 'SaasInvoice',
        entityId: paidInvoice.id,
        next: this.fiscalHandoff(paidInvoice),
      },
      tx,
    );

    return {
      invoice: paidInvoice,
      agreement: updatedAgreement,
      productSubscriptionId: nextSubscriptionId,
    };
  }

  private async handlePaymentFailed(
    tx: Prisma.TransactionClient,
    providerCode: string,
    dto: BillingWebhookDto,
  ) {
    const { invoice } = await this.invoiceForWebhook(tx, providerCode, dto);
    const data = dto.data;
    const providerPaymentRef = this.requiredText(data, 'providerPaymentRef');
    const amountMinor = this.requiredPositiveInt(data, 'amountMinor');
    const currency = this.requiredText(data, 'currency');
    if (amountMinor !== invoice.amountDueMinor || currency !== invoice.currency) {
      throw new ConflictException('Falha de pagamento diverge do invoice SaaS');
    }

    const existing = await tx.saasPayment.findUnique({
      where: {
        providerCode_providerPaymentRef: { providerCode, providerPaymentRef },
      },
    });
    if (!existing) {
      await tx.saasPayment.create({
        data: {
          invoiceId: invoice.id,
          providerCode,
          providerPaymentRef,
          amountMinor,
          currency,
          status: SaasPaymentStatus.FAILED,
        },
      });
    } else if (
      existing.invoiceId !== invoice.id ||
      existing.amountMinor !== amountMinor ||
      existing.currency !== currency
    ) {
      throw new ConflictException('Referencia de pagamento falho reutilizada');
    }

    await tx.saasInvoice.update({
      where: { id: invoice.id },
      data: { status: SaasInvoiceStatus.FAILED },
    });

    const agreement = await tx.saasBillingAgreement.findUnique({
      where: { id: invoice.agreementId },
    });
    if (!agreement || agreement.status === SaasBillingAgreementStatus.CANCELED) {
      return { invoiceId: invoice.id, ignoredAgreement: true };
    }

    const updated = await tx.saasBillingAgreement.update({
      where: { id: agreement.id },
      data: {
        status: SaasBillingAgreementStatus.PAST_DUE,
        pastDueSince: agreement.pastDueSince ?? new Date(dto.occurredAt),
      },
    });

    await this.audit.record(
      {
        gymId: agreement.gymId,
        action: 'SAAS_PAYMENT_FAILED',
        entity: 'SaasInvoice',
        entityId: invoice.id,
        next: {
          providerCode,
          providerPaymentRef,
          agreementStatus: updated.status,
        },
      },
      tx,
    );
    return { invoiceId: invoice.id, agreement: updated };
  }

  private async handleCheckoutCompleted(
    tx: Prisma.TransactionClient,
    providerCode: string,
    dto: BillingWebhookDto,
  ) {
    const providerSessionRef = this.requiredText(dto.data, 'providerSessionRef');
    const checkout = await tx.saasCheckoutSession.findUnique({
      where: {
        providerCode_providerSessionRef: {
          providerCode,
          providerSessionRef,
        },
      },
    });
    if (!checkout) throw new NotFoundException('Checkout SaaS nao encontrado');
    if (checkout.status === SaasCheckoutStatus.COMPLETED) {
      return { checkout, idempotent: true };
    }
    const updated = await tx.saasCheckoutSession.update({
      where: { id: checkout.id },
      data: { status: SaasCheckoutStatus.COMPLETED },
    });
    return { checkout: updated, idempotent: false };
  }

  async processWebhook(
    providerCode: string,
    signature: string | undefined,
    dto: BillingWebhookDto,
  ) {
    const provider = await this.provider(providerCode);
    provider.adapter.verifyWebhook(dto, signature, provider.context);
    const payloadHash = billingPayloadHash(dto);

    const previous = await this.prisma.saasWebhookEvent.findUnique({
      where: {
        providerCode_providerEventId: {
          providerCode,
          providerEventId: dto.eventId,
        },
      },
    });
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new ConflictException('Webhook eventId reutilizado com payload diferente');
      }
      if (previous.status === SaasWebhookStatus.PROCESSED) {
        return { idempotent: true, eventId: dto.eventId };
      }
    }

    try {
      const result = await this.serializable(async (tx) => {
        await tx.saasWebhookEvent.upsert({
          where: {
            providerCode_providerEventId: {
              providerCode,
              providerEventId: dto.eventId,
            },
          },
          create: {
            providerCode,
            providerEventId: dto.eventId,
            eventType: dto.eventType,
            payloadHash,
            status: SaasWebhookStatus.RECEIVED,
          },
          update: {
            status: SaasWebhookStatus.RECEIVED,
            errorCode: null,
          },
        });

        let outcome: unknown;
        if (dto.eventType === 'invoice.paid') {
          outcome = await this.handleInvoicePaid(tx, providerCode, dto);
        } else if (dto.eventType === 'invoice.payment_failed') {
          outcome = await this.handlePaymentFailed(tx, providerCode, dto);
        } else {
          outcome = await this.handleCheckoutCompleted(tx, providerCode, dto);
        }

        await tx.saasWebhookEvent.update({
          where: {
            providerCode_providerEventId: {
              providerCode,
              providerEventId: dto.eventId,
            },
          },
          data: {
            status: SaasWebhookStatus.PROCESSED,
            processedAt: new Date(),
          },
        });

        return { idempotent: false, eventId: dto.eventId, outcome };
      });
      return result;
    } catch (error) {
      await this.prisma.saasWebhookEvent
        .upsert({
          where: {
            providerCode_providerEventId: {
              providerCode,
              providerEventId: dto.eventId,
            },
          },
          create: {
            providerCode,
            providerEventId: dto.eventId,
            eventType: dto.eventType,
            payloadHash,
            status: SaasWebhookStatus.FAILED,
            errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          },
          update: {
            status: SaasWebhookStatus.FAILED,
            errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private asOf(dto: RunSaasBillingDto): Date {
    const date = dto.asOf ? new Date(dto.asOf) : new Date();
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('asOf invalido');
    }
    return date;
  }

  private pendingTransition(agreement: any) {
    const value = agreement.pendingTransition as any;
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.priceCode !== 'string' ||
      typeof value.effectiveAt !== 'string'
    ) {
      return null;
    }
    const effectiveAt = new Date(value.effectiveAt);
    if (Number.isNaN(effectiveAt.getTime())) return null;
    return { ...value, effectiveAt };
  }

  async runRecurrence(dto: RunSaasBillingDto, actorUserId?: string) {
    const asOf = this.asOf(dto);
    const commercialPolicy = await this.approvedCommercialPolicy();
    const dueDays = commercialPolicy.invoiceDueDays as number;
    const candidates = await this.prisma.saasBillingAgreement.findMany({
      where: {
        status: {
          in: [
            SaasBillingAgreementStatus.ACTIVE,
            SaasBillingAgreementStatus.PAST_DUE,
          ],
        },
        nextBillingAt: { lte: asOf },
      },
      select: { id: true },
    });

    let generated = 0;
    let canceled = 0;
    for (const candidate of candidates) {
      const outcome = await this.serializable(async (tx) => {
        const agreement = await tx.saasBillingAgreement.findUnique({
          where: { id: candidate.id },
          include: { price: true, productSubscription: true },
        });
        if (!agreement?.nextBillingAt || !agreement.price) return 'SKIPPED';

        if (agreement.cancelAtPeriodEnd && agreement.nextBillingAt <= asOf) {
          const subscription = agreement.productSubscription;
          if (subscription.status !== TenantProductSubscriptionStatus.CANCELED) {
            const minimumEnd = new Date(subscription.effectiveFrom.getTime() + 1);
            const effectiveUntil =
              agreement.nextBillingAt > minimumEnd
                ? agreement.nextBillingAt
                : minimumEnd;
            await tx.tenantProductSubscription.update({
              where: { id: subscription.id },
              data: {
                status: TenantProductSubscriptionStatus.CANCELED,
                effectiveUntil,
              },
            });
          }
          await tx.saasBillingAgreement.update({
            where: { id: agreement.id },
            data: {
              status: SaasBillingAgreementStatus.CANCELED,
              canceledAt: agreement.nextBillingAt,
              cancelAtPeriodEnd: false,
              pendingTransition: Prisma.DbNull,
            },
          });
          await this.audit.record(
            {
              gymId: agreement.gymId,
              userId: actorUserId ?? null,
              action: 'SAAS_BILLING_CANCELED_AT_PERIOD_END',
              entity: 'SaasBillingAgreement',
              entityId: agreement.id,
            },
            tx,
          );
          return 'CANCELED';
        }

        const periodStart = agreement.nextBillingAt;
        let price = agreement.price;
        const pending = this.pendingTransition(agreement);
        if (pending && pending.effectiveAt <= periodStart) {
          price = await this.priceByCode(tx, pending.priceCode, periodStart);
        }

        const periodEnd = this.periodEnd(periodStart, price.interval);
        const idempotencyKey = `recurrence:${agreement.id}:${periodStart.toISOString()}`;
        const existing = await tx.saasInvoice.findUnique({
          where: { idempotencyKey },
        });
        if (!existing) {
          await tx.saasInvoice.create({
            data: {
              idempotencyKey,
              agreementId: agreement.id,
              gymId: agreement.gymId,
              priceId: price.id,
              providerCode: agreement.providerCode,
              periodStart,
              periodEnd,
              amountDueMinor: price.amountMinor,
              currency: price.currency,
              dueAt: new Date(periodStart.getTime() + dueDays * DAY_MS),
            },
          });
          await this.audit.record(
            {
              gymId: agreement.gymId,
              userId: actorUserId ?? null,
              action: 'SAAS_RECURRING_INVOICE_CREATED',
              entity: 'SaasBillingAgreement',
              entityId: agreement.id,
              next: {
                idempotencyKey,
                priceCode: price.priceCode,
                amountMinor: price.amountMinor,
                currency: price.currency,
                periodStart,
                periodEnd,
              },
            },
            tx,
          );
        }
        await tx.saasBillingAgreement.update({
          where: { id: agreement.id },
          data: { nextBillingAt: periodEnd },
        });
        return existing ? 'IDEMPOTENT' : 'GENERATED';
      });
      if (outcome === 'GENERATED') generated += 1;
      if (outcome === 'CANCELED') canceled += 1;
    }
    return { asOf, candidates: candidates.length, generated, canceled };
  }

  async runDunning(dto: RunSaasBillingDto, actorUserId?: string) {
    const asOf = this.asOf(dto);
    const commercialPolicy = await this.approvedCommercialPolicy();
    const graceDays = commercialPolicy.dunningGraceDays as number;
    const invoices = await this.prisma.saasInvoice.findMany({
      where: {
        status: { in: [SaasInvoiceStatus.OPEN, SaasInvoiceStatus.FAILED] },
        dueAt: { lt: asOf },
      },
      select: { id: true },
    });

    let pastDue = 0;
    let suspended = 0;
    for (const candidate of invoices) {
      const outcome = await this.serializable(async (tx) => {
        const invoice = await tx.saasInvoice.findUnique({
          where: { id: candidate.id },
          include: { agreement: true },
        });
        if (!invoice || invoice.agreement.status === SaasBillingAgreementStatus.CANCELED) {
          return 'SKIPPED';
        }
        const agreement = invoice.agreement;
        const pastDueSince = agreement.pastDueSince ?? invoice.dueAt;
        const shouldSuspend =
          asOf.getTime() - pastDueSince.getTime() >= graceDays * DAY_MS;
        const targetStatus = shouldSuspend
          ? SaasBillingAgreementStatus.SUSPENDED
          : SaasBillingAgreementStatus.PAST_DUE;

        if (agreement.status === targetStatus) return 'IDEMPOTENT';

        await tx.saasBillingAgreement.update({
          where: { id: agreement.id },
          data: { status: targetStatus, pastDueSince },
        });

        if (shouldSuspend) {
          await tx.tenantProductSubscription.updateMany({
            where: {
              id: agreement.tenantProductSubscriptionId,
              status: TenantProductSubscriptionStatus.ACTIVE,
            },
            data: { status: TenantProductSubscriptionStatus.SUSPENDED },
          });
        }

        await this.audit.record(
          {
            gymId: agreement.gymId,
            userId: actorUserId ?? null,
            action: shouldSuspend
              ? 'SAAS_DUNNING_SUSPENDED'
              : 'SAAS_DUNNING_PAST_DUE',
            entity: 'SaasBillingAgreement',
            entityId: agreement.id,
            next: {
              invoiceId: invoice.id,
              pastDueSince,
              graceDays,
              status: targetStatus,
            },
          },
          tx,
        );
        return shouldSuspend ? 'SUSPENDED' : 'PAST_DUE';
      });
      if (outcome === 'PAST_DUE') pastDue += 1;
      if (outcome === 'SUSPENDED') suspended += 1;
    }

    return { asOf, overdueInvoices: invoices.length, pastDue, suspended };
  }

  async refund(dto: RefundSaasBillingDto, actorUserId?: string) {
    const provider = await this.provider();
    const replay = await this.prisma.saasRefund.findUnique({
      where: { requestId: dto.requestId },
    });
    if (replay) {
      if (
        replay.invoiceId !== dto.invoiceId ||
        replay.amountMinor !== dto.amountMinor ||
        replay.reason !== dto.reason
      ) {
        throw new ConflictException('requestId de refund reutilizado com dados diferentes');
      }
      return { ...replay, idempotent: true };
    }

    const invoice = await this.prisma.saasInvoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        payments: true,
        refunds: true,
        agreement: true,
      },
    });
    if (!invoice || invoice.status === SaasInvoiceStatus.VOID) {
      throw new NotFoundException('Invoice SaaS elegivel para refund nao encontrado');
    }
    const payment = invoice.payments.find(
      (item) =>
        item.status === SaasPaymentStatus.SUCCEEDED ||
        item.status === SaasPaymentStatus.REFUNDED,
    );
    if (!payment) throw new ConflictException('Invoice SaaS nao possui pagamento confirmado');

    const refunded = invoice.refunds
      .filter((item) => item.status === SaasRefundStatus.SUCCEEDED)
      .reduce((sum, item) => sum + item.amountMinor, 0);
    if (refunded + dto.amountMinor > payment.amountMinor) {
      throw new ConflictException('Refund excede valor pago do invoice SaaS');
    }

    const providerResult = await provider.adapter.requestRefund({
      requestId: dto.requestId,
      providerPaymentRef: payment.providerPaymentRef,
      amountMinor: dto.amountMinor,
      currency: payment.currency,
      reason: dto.reason,
    }, provider.context);

    return this.serializable(async (tx) => {
      const existing = await tx.saasRefund.findUnique({
        where: { requestId: dto.requestId },
      });
      if (existing) return { ...existing, idempotent: true };

      const refund = await tx.saasRefund.create({
        data: {
          requestId: dto.requestId,
          invoiceId: invoice.id,
          paymentId: payment.id,
          providerCode: provider.code,
          providerRefundRef: providerResult.providerRefundRef,
          amountMinor: dto.amountMinor,
          status:
            providerResult.status === 'SUCCEEDED'
              ? SaasRefundStatus.SUCCEEDED
              : SaasRefundStatus.PENDING,
          reason: dto.reason,
        },
      });

      if (refund.status === SaasRefundStatus.SUCCEEDED) {
        const totalRefunded = refunded + refund.amountMinor;
        const full = totalRefunded === payment.amountMinor;
        await tx.saasInvoice.update({
          where: { id: invoice.id },
          data: {
            status: full
              ? SaasInvoiceStatus.REFUNDED
              : SaasInvoiceStatus.PARTIALLY_REFUNDED,
          },
        });
        if (full) {
          await tx.saasPayment.update({
            where: { id: payment.id },
            data: { status: SaasPaymentStatus.REFUNDED },
          });
        }
      }

      await this.audit.record(
        {
          gymId: invoice.gymId,
          userId: actorUserId ?? null,
          action: 'SAAS_REFUND_REQUESTED',
          entity: 'SaasRefund',
          entityId: refund.id,
          next: {
            invoiceId: invoice.id,
            amountMinor: refund.amountMinor,
            currency: invoice.currency,
            status: refund.status,
            entitlementPolicy: 'REFUND_DOES_NOT_MUTATE_ACCESS',
          },
        },
        tx,
      );

      return { ...refund, idempotent: false };
    });
  }

  async reconcile(actorUserId?: string) {
    const agreements = await this.prisma.saasBillingAgreement.findMany({
      include: {
        productSubscription: true,
        invoices: {
          include: { payments: true, refunds: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    let matched = 0;
    let mismatches = 0;
    for (const agreement of agreements) {
      const expectedSubscriptionStatus =
        agreement.status === SaasBillingAgreementStatus.ACTIVE ||
        agreement.status === SaasBillingAgreementStatus.PAST_DUE
          ? TenantProductSubscriptionStatus.ACTIVE
          : agreement.status === SaasBillingAgreementStatus.SUSPENDED
            ? TenantProductSubscriptionStatus.SUSPENDED
            : agreement.status === SaasBillingAgreementStatus.CANCELED
              ? TenantProductSubscriptionStatus.CANCELED
              : null;

      const agreementMismatch =
        expectedSubscriptionStatus !== null &&
        agreement.productSubscription.status !== expectedSubscriptionStatus;

      await this.prisma.saasBillingReconciliation.create({
        data: {
          agreementId: agreement.id,
          status: agreementMismatch
            ? SaasReconciliationStatus.MISMATCH
            : SaasReconciliationStatus.MATCHED,
          details: {
            type: 'AGREEMENT_CANONICAL_SUBSCRIPTION',
            agreementStatus: agreement.status,
            expectedSubscriptionStatus,
            actualSubscriptionStatus: agreement.productSubscription.status,
          },
        },
      });
      if (agreementMismatch) mismatches += 1;
      else matched += 1;

      for (const invoice of agreement.invoices) {
        const observed = invoice.payments
          .filter(
            (payment) =>
              payment.status === SaasPaymentStatus.SUCCEEDED ||
              payment.status === SaasPaymentStatus.REFUNDED,
          )
          .reduce((sum, payment) => sum + payment.amountMinor, 0);
        const mismatch = observed !== invoice.amountPaidMinor;
        await this.prisma.saasBillingReconciliation.create({
          data: {
            agreementId: agreement.id,
            invoiceId: invoice.id,
            status: mismatch
              ? SaasReconciliationStatus.MISMATCH
              : SaasReconciliationStatus.MATCHED,
            expectedAmountMinor: invoice.amountPaidMinor,
            observedAmountMinor: observed,
            details: {
              type: 'INVOICE_PAYMENT_LEDGER',
              invoiceStatus: invoice.status,
              refundCount: invoice.refunds.length,
            },
          },
        });
        if (mismatch) mismatches += 1;
        else matched += 1;
      }
    }

    await this.audit.record({
      userId: actorUserId ?? null,
      action: 'SAAS_BILLING_RECONCILIATION_RUN',
      entity: 'SaasBillingReconciliation',
      next: { agreements: agreements.length, matched, mismatches },
    });

    return { agreements: agreements.length, matched, mismatches };
  }
}
