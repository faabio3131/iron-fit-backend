import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductPlanVersionStatus,
  TenantProductSubscriptionStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TransitionTenantProductSubscriptionDto } from './dto/transition-tenant-product-subscription.dto';

const SERIALIZABLE_ATTEMPTS = 3;

@Injectable()
export class TenantProductSubscriptionLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
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

    throw new ConflictException('Falha de concorrencia na transicao de plano SaaS');
  }

  private subscriptionSnapshot(subscription: any) {
    return {
      id: subscription.id,
      gymId: subscription.gymId,
      status: subscription.status,
      effectiveFrom: subscription.effectiveFrom,
      effectiveUntil: subscription.effectiveUntil,
      planCode: subscription.planVersion.productPlan.code,
      version: subscription.planVersion.version,
      planVersionStatus: subscription.planVersion.status,
    };
  }

  async transitionWithTx(
    tx: Prisma.TransactionClient,
    dto: TransitionTenantProductSubscriptionDto,
    actorUserId?: string,
  ) {
    const gym = await tx.gym.findUnique({
      where: { id: dto.gymId },
      select: { id: true, active: true },
    });
    if (!gym) throw new NotFoundException('Gym nao encontrada');
    if (!gym.active) {
      throw new ConflictException('Gym inativa nao pode trocar plano SaaS');
    }

    const targetVersion = await tx.productPlanVersion.findFirst({
      where: {
        version: dto.version,
        productPlan: { code: dto.planCode },
      },
      include: { productPlan: true },
    });
    if (!targetVersion) {
      throw new NotFoundException('Versao alvo de ProductPlan nao encontrada');
    }
    if (targetVersion.status !== ProductPlanVersionStatus.PUBLISHED) {
      throw new ConflictException(
        'Somente versao PUBLISHED pode receber nova transicao de assinatura tenant',
      );
    }

    const current = await tx.tenantProductSubscription.findFirst({
      where: {
        gymId: dto.gymId,
        status: TenantProductSubscriptionStatus.ACTIVE,
      },
      include: { planVersion: { include: { productPlan: true } } },
    });
    if (!current) {
      throw new ConflictException('Tenant nao possui assinatura SaaS ACTIVE para transicao');
    }

    if (current.planVersionId === targetVersion.id) {
      return {
        changed: false,
        idempotent: true,
        transitionKind: dto.transitionKind,
        subscription: current,
      };
    }

    if (current.id !== dto.expectedCurrentSubscriptionId) {
      throw new ConflictException(
        'Assinatura SaaS corrente mudou; recarregue o estado antes de nova transicao',
      );
    }

    const now = new Date();
    const minimumEnd = new Date(current.effectiveFrom.getTime() + 1);
    const effectiveUntil = now > minimumEnd ? now : minimumEnd;

    const closed = await tx.tenantProductSubscription.update({
      where: { id: current.id },
      data: {
        status: TenantProductSubscriptionStatus.CANCELED,
        effectiveUntil,
      },
      include: { planVersion: { include: { productPlan: true } } },
    });

    const next = await tx.tenantProductSubscription.create({
      data: {
        gymId: dto.gymId,
        planVersionId: targetVersion.id,
        status: TenantProductSubscriptionStatus.ACTIVE,
        effectiveFrom: effectiveUntil,
      },
      include: { planVersion: { include: { productPlan: true } } },
    });

    await this.audit.record(
      {
        gymId: dto.gymId,
        userId: actorUserId ?? null,
        action: 'TENANT_PRODUCT_SUBSCRIPTION_TRANSITIONED',
        entity: 'TenantProductSubscription',
        entityId: next.id,
        previous: {
          ...this.subscriptionSnapshot(closed),
          transitionKind: dto.transitionKind,
          reason: dto.reason,
        },
        next: {
          ...this.subscriptionSnapshot(next),
          transitionKind: dto.transitionKind,
          reason: dto.reason,
          previousSubscriptionId: closed.id,
        },
      },
      tx,
    );

    return {
      changed: true,
      idempotent: false,
      transitionKind: dto.transitionKind,
      previousSubscription: closed,
      subscription: next,
    };
  }

  async transition(
    dto: TransitionTenantProductSubscriptionDto,
    actorUserId?: string,
  ) {
    return this.serializable((tx) => this.transitionWithTx(tx, dto, actorUserId));
  }
}
