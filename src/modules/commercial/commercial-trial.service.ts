import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TenantProductSubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StartTrialDto } from './dto/start-trial.dto';
import {
  COMMERCIAL_ONBOARDING_STEPS,
  CommercialOnboardingStep,
  UpdateOnboardingDto,
} from './dto/update-onboarding.dto';

const SERIALIZABLE_ATTEMPTS = 3;
const ONBOARDING_ACTION = 'COMMERCIAL_ONBOARDING_STEP_COMPLETED';
const PROVISIONED_ACTION = 'COMMERCIAL_TRIAL_PROVISIONED';
const TRIAL_EXPIRED_ACTION = 'COMMERCIAL_TRIAL_EXPIRED';

type CommercialDb = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CommercialTrialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private trialConfig() {
    const planCode = this.config.get<string>('IRON_FIT_TRIAL_PLAN_CODE')?.trim();
    const daysRaw = this.config.get<string>('IRON_FIT_TRIAL_DAYS')?.trim();
    const days = Number(daysRaw);
    if (!planCode || !Number.isInteger(days) || days < 1 || days > 90) {
      throw new ServiceUnavailableException('Trial comercial nao configurado');
    }
    return { planCode, days };
  }

  private gymSlug(gymName: string, requestId: string) {
    const base = gymName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'academia';
    const suffix = createHash('sha256').update(requestId).digest('hex').slice(0, 12);
    return `${base}-${suffix}`;
  }

  private requestFingerprint(input: {
    email: string;
    name: string;
    phone: string | null;
    gymName: string;
    timezone: string;
  }) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private async previousProvisioning(
    db: CommercialDb,
    requestId: string,
    requestFingerprint: string,
  ) {
    const previous = await db.commercialTrialProvisioning.findUnique({
      where: { requestId },
    });
    if (!previous) return null;
    if (previous.requestFingerprint !== requestFingerprint) {
      throw new ConflictException('Chave de idempotencia reutilizada com dados diferentes');
    }
    return {
      requestId,
      userId: previous.userId,
      gymId: previous.gymId,
      subscriptionId: previous.subscriptionId,
      trialEndsAt: previous.trialEndsAt,
      idempotentReplay: true,
    };
  }

  private retryable(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002');
  }

  async startTrial(dto: StartTrialDto) {
    const config = this.trialConfig();
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    const phone = dto.phone?.trim() || null;
    const gymName = dto.gymName.trim();
    const slug = this.gymSlug(gymName, dto.requestId);
    const timezone = dto.timezone?.trim() || 'America/Sao_Paulo';
    const fingerprint = this.requestFingerprint({ email, name, phone, gymName, timezone });
    const passwordHash = await bcrypt.hash(dto.password, 12);

    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const replay = await this.previousProvisioning(tx, dto.requestId, fingerprint);
          if (replay) return replay;

          const existingUser = await tx.user.findUnique({ where: { email } });
          if (existingUser) {
            throw new ConflictException('Cadastro indisponivel para estes dados');
          }

          const existingGym = await tx.gym.findUnique({ where: { slug } });
          if (existingGym) {
            throw new ConflictException('Cadastro indisponivel para estes dados');
          }

          const ownerRole = await tx.role.findUnique({ where: { name: 'OWNER' } });
          if (!ownerRole) throw new ServiceUnavailableException('RBAC OWNER nao configurado');

          const planVersion = await tx.productPlanVersion.findFirst({
            where: {
              status: 'PUBLISHED',
              productPlan: { code: config.planCode },
            },
            orderBy: { version: 'desc' },
            include: { productPlan: true },
          });
          if (!planVersion) {
            throw new ServiceUnavailableException('Plano de trial PUBLISHED nao configurado');
          }

          const user = await tx.user.create({
            data: {
              email,
              name,
              phone,
              passwordHash,
            },
          });
          const gym = await tx.gym.create({
            data: { name: gymName, slug, timezone },
          });
          await tx.userRole.create({
            data: { userId: user.id, roleId: ownerRole.id, gymId: gym.id, assignedBy: user.id },
          });

          const startedAt = new Date();
          const endsAt = new Date(startedAt.getTime() + config.days * 24 * 60 * 60 * 1000);
          const subscription = await tx.tenantProductSubscription.create({
            data: {
              gymId: gym.id,
              planVersionId: planVersion.id,
              status: TenantProductSubscriptionStatus.ACTIVE,
              effectiveFrom: startedAt,
              effectiveUntil: endsAt,
            },
          });

          await tx.commercialTrialProvisioning.create({
            data: {
              requestId: dto.requestId,
              requestFingerprint: fingerprint,
              userId: user.id,
              gymId: gym.id,
              subscriptionId: subscription.id,
              trialStartedAt: startedAt,
              trialEndsAt: endsAt,
            },
          });

          await this.audit.record({
            gymId: gym.id,
            userId: user.id,
            action: PROVISIONED_ACTION,
            entity: 'CommercialTrial',
            entityId: dto.requestId,
            next: {
              requestId: dto.requestId,
              userId: user.id,
              gymId: gym.id,
              subscriptionId: subscription.id,
              planCode: planVersion.productPlan.code,
              planVersion: planVersion.version,
              trialStartedAt: startedAt,
              trialEndsAt: endsAt,
            },
          }, tx);

          return {
            requestId: dto.requestId,
            userId: user.id,
            gymId: gym.id,
            subscriptionId: subscription.id,
            trialEndsAt: endsAt,
            idempotentReplay: false,
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!this.retryable(error) || attempt === SERIALIZABLE_ATTEMPTS) throw error;
      }
    }

    throw new ConflictException('Falha de concorrencia ao provisionar trial');
  }

  async synchronizeTrial(gymId?: string, userId?: string) {
    if (!gymId) throw new BadRequestException('Tenant ativo obrigatorio');
    const subscription = await this.prisma.tenantProductSubscription.findFirst({
      where: { gymId, status: TenantProductSubscriptionStatus.ACTIVE },
      orderBy: { effectiveFrom: 'desc' },
      include: { planVersion: { include: { productPlan: true } } },
    });
    if (!subscription) return { status: 'INACTIVE', subscription: null };

    if (subscription.effectiveUntil && subscription.effectiveUntil.getTime() <= Date.now()) {
      const expired = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.tenantProductSubscription.updateMany({
          where: { id: subscription.id, status: TenantProductSubscriptionStatus.ACTIVE },
          data: { status: TenantProductSubscriptionStatus.SUSPENDED },
        });
        if (updated.count > 0) {
          await this.audit.record({
            gymId,
            userId: userId ?? null,
            action: TRIAL_EXPIRED_ACTION,
            entity: 'TenantProductSubscription',
            entityId: subscription.id,
            next: { effectiveUntil: subscription.effectiveUntil, status: 'SUSPENDED' },
          }, tx);
        }
        return updated.count;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { status: 'EXPIRED', subscriptionId: subscription.id, changed: expired > 0 };
    }

    return {
      status: subscription.effectiveUntil ? 'TRIALING' : 'ACTIVE',
      subscriptionId: subscription.id,
      planCode: subscription.planVersion.productPlan.code,
      effectiveFrom: subscription.effectiveFrom,
      effectiveUntil: subscription.effectiveUntil,
    };
  }

  private async completedSteps(gymId: string, db: CommercialDb = this.prisma) {
    const checkpoints = await db.commercialOnboardingCheckpoint.findMany({
      where: { gymId },
      orderBy: { completedAt: 'asc' },
      select: { step: true },
    });
    const completed = new Set<CommercialOnboardingStep>();
    for (const checkpoint of checkpoints) {
      if (
        typeof checkpoint.step === 'string' &&
        COMMERCIAL_ONBOARDING_STEPS.includes(checkpoint.step as CommercialOnboardingStep)
      ) {
        completed.add(checkpoint.step as CommercialOnboardingStep);
      }
    }
    return completed;
  }

  private onboardingState(completed: Set<CommercialOnboardingStep>) {
    return {
      status: completed.has('FINISH')
        ? 'COMPLETED'
        : completed.size > 0
          ? 'IN_PROGRESS'
          : 'NOT_STARTED',
      completedSteps: COMMERCIAL_ONBOARDING_STEPS.filter((step) => completed.has(step)),
      nextStep: COMMERCIAL_ONBOARDING_STEPS.find((step) => !completed.has(step)) ?? null,
    };
  }

  async getOnboarding(gymId?: string) {
    if (!gymId) throw new BadRequestException('Tenant ativo obrigatorio');
    const gym = await this.prisma.gym.findUnique({
      where: { id: gymId },
      select: { id: true, active: true },
    });
    if (!gym?.active) throw new NotFoundException('Gym ativa nao encontrada');
    return this.onboardingState(await this.completedSteps(gymId));
  }

  async updateOnboarding(gymId: string | undefined, userId: string | undefined, dto: UpdateOnboardingDto) {
    if (!gymId || !userId) throw new BadRequestException('Tenant e usuario autenticados obrigatorios');

    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const gym = await tx.gym.findUnique({
            where: { id: gymId },
            select: { id: true, active: true },
          });
          if (!gym?.active) throw new NotFoundException('Gym ativa nao encontrada');

          const current = await this.completedSteps(gymId, tx);
          if (current.has(dto.step)) return this.onboardingState(current);

          const index = COMMERCIAL_ONBOARDING_STEPS.indexOf(dto.step);
          const required = COMMERCIAL_ONBOARDING_STEPS.slice(0, index);
          if (required.some((step) => !current.has(step))) {
            throw new ConflictException('Etapas anteriores do onboarding ainda nao foram concluidas');
          }

          if (dto.step === 'ACADEMY_PROFILE') {
            const name = typeof dto.data?.name === 'string' ? dto.data.name.trim() : '';
            const timezone = typeof dto.data?.timezone === 'string' ? dto.data.timezone.trim() : '';
            if (name.length < 2 || !/^[A-Za-z_]+\/[A-Za-z_]+$/.test(timezone)) {
              throw new BadRequestException('Perfil da academia invalido');
            }
            await tx.gym.update({ where: { id: gymId }, data: { name, timezone } });
          }

          await tx.commercialOnboardingCheckpoint.create({
            data: {
              gymId,
              step: dto.step,
              completedByUserId: userId,
            },
          });

          await this.audit.record({
            gymId,
            userId,
            action: ONBOARDING_ACTION,
            entity: 'Gym',
            entityId: gymId,
            next: { step: dto.step },
          }, tx);

          const completed = new Set(current);
          completed.add(dto.step);
          return this.onboardingState(completed);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!this.retryable(error) || attempt === SERIALIZABLE_ATTEMPTS) throw error;
      }
    }

    throw new ConflictException('Falha de concorrencia ao atualizar onboarding');
  }
}
