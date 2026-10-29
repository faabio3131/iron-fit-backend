import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ManagerAlertCategory,
  ManagerAlertSeverity,
  ManagerAlertStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ManagerAlertQueryDto } from './dto/manager-alert-query.dto';
import { UpdateManagerAlertPreferenceDto } from './dto/update-manager-alert-preference.dto';
import { UpdateManagerAlertPolicyDto } from './dto/update-manager-alert-policy.dto';

export interface CreateManagerAlertInput {
  gymId: string;
  category: ManagerAlertCategory;
  severity: ManagerAlertSeverity;
  eventKey: string;
  deduplicationKey: string;
  title: string;
  message: string;
  occurredAt?: Date;
  resourceType?: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
}

const OWNER_ONLY = new Set<ManagerAlertCategory>([
  ManagerAlertCategory.STUDENT_BILLING,
  ManagerAlertCategory.SECURITY,
]);

@Injectable()
export class ManagerAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Canonical ingestion entry point for domain producers. Safe under replay. */
  async ingest(input: CreateManagerAlertInput) {
    const roles: RoleName[] = OWNER_ONLY.has(input.category)
      ? [RoleName.OWNER]
      : [RoleName.OWNER, RoleName.MANAGER];

    try {
      return await this.prisma.$transaction(async (tx) => {
        const memberships = await tx.userRole.findMany({
          where: {
            gymId: input.gymId,
            active: true,
            user: { active: true },
            role: { name: { in: roles } },
          },
          select: { userId: true, role: { select: { name: true } } },
          distinct: ['userId'],
        });

        const alert = await tx.managerAlert.create({
          data: {
            gymId: input.gymId,
            category: input.category,
            severity: input.severity,
            eventKey: input.eventKey,
            deduplicationKey: input.deduplicationKey,
            title: input.title,
            message: input.message,
            occurredAt: input.occurredAt,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            metadata: input.metadata,
            recipients: {
              create: memberships.map((membership) => ({
                userId: membership.userId,
                roleSnapshot: membership.role.name,
              })),
            },
          },
          include: { recipients: true },
        });

        await this.audit.record({
          gymId: input.gymId,
          action: 'MANAGER_ALERT_CREATED',
          entity: 'ManagerAlert',
          entityId: alert.id,
          next: {
            category: alert.category,
            severity: alert.severity,
            recipientCount: alert.recipients.length,
            eventKey: alert.eventKey,
          },
        }, tx);
        return { alert, replayed: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const alert = await this.prisma.managerAlert.findUniqueOrThrow({
          where: {
            gymId_deduplicationKey: {
              gymId: input.gymId,
              deduplicationKey: input.deduplicationKey,
            },
          },
          include: { recipients: true },
        });
        return { alert, replayed: true };
      }
      throw error;
    }
  }

  async list(actor: any, query: ManagerAlertQueryDto) {
    const gymId = this.requireGym(actor);
    const where: Prisma.ManagerAlertWhereInput = {
      gymId,
      status: query.status,
      severity: query.severity,
      category: query.category,
      recipients: { some: { userId: actor.id } },
    };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.managerAlert.findMany({
        where,
        select: {
          id: true, category: true, severity: true, status: true, title: true,
          message: true, resourceType: true, resourceId: true, occurredAt: true,
          createdAt: true, acknowledgedAt: true, resolvedAt: true, dismissedAt: true,
          recipients: {
            where: { userId: actor.id },
            select: { readAt: true, acknowledgedAt: true },
          },
        },
        orderBy: { occurredAt: 'desc' },
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.managerAlert.count({ where }),
      this.prisma.managerAlertRecipient.count({
        where: { userId: actor.id, readAt: null, alert: { gymId } },
      }),
    ]);
    return {
      items: items.map(({ recipients, ...item }) => ({ ...item, recipient: recipients[0] })),
      page: { total, unread, limit: query.limit, offset: query.offset },
    };
  }

  async counters(actor: any) {
    const gymId = this.requireGym(actor);
    const base = { gymId, recipients: { some: { userId: actor.id } } };
    const [unread, open, critical] = await this.prisma.$transaction([
      this.prisma.managerAlertRecipient.count({ where: { userId: actor.id, readAt: null, alert: { gymId } } }),
      this.prisma.managerAlert.count({ where: { ...base, status: ManagerAlertStatus.OPEN } }),
      this.prisma.managerAlert.count({ where: { ...base, severity: ManagerAlertSeverity.CRITICAL, status: { in: [ManagerAlertStatus.OPEN, ManagerAlertStatus.ACKNOWLEDGED] } } }),
    ]);
    return { unread, open, critical };
  }

  async preferences(actor: any) {
    const gymId = this.requireGym(actor);
    return this.prisma.managerAlertPreference.findMany({
      where: { gymId, userId: actor.id },
      orderBy: { category: 'asc' },
      select: {
        category: true, inAppEnabled: true, emailEnabled: true, pushEnabled: true,
        whatsappEnabled: true, minimumSeverity: true, quietHoursStart: true,
        quietHoursEnd: true, timezone: true, updatedAt: true,
      },
    });
  }

  async updatePreference(categoryValue: string, dto: UpdateManagerAlertPreferenceDto, actor: any) {
    const gymId = this.requireGym(actor);
    if (!Object.values(ManagerAlertCategory).includes(categoryValue as ManagerAlertCategory)) {
      throw new BadRequestException('Categoria de alerta invalida');
    }
    const category = categoryValue as ManagerAlertCategory;
    if ((dto.quietHoursStart === undefined) !== (dto.quietHoursEnd === undefined)) {
      throw new BadRequestException('Inicio e fim do horario silencioso devem ser informados juntos');
    }
    if (dto.timezone) {
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: dto.timezone }).format();
      } catch {
        throw new BadRequestException('Timezone invalido');
      }
    }
    if (category === ManagerAlertCategory.SECURITY) {
      if (dto.minimumSeverity && dto.minimumSeverity !== 'INFO') {
        throw new BadRequestException('Alertas de seguranca nao podem ser filtrados por severidade');
      }
    }

    const membership = await this.prisma.userRole.findFirst({
      where: {
        gymId, userId: actor.id, active: true,
        role: { name: { in: [RoleName.OWNER, RoleName.MANAGER] } },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('Membership de gestor inativa ou inexistente');

    const data = {
      emailEnabled: dto.emailEnabled,
      pushEnabled: dto.pushEnabled,
      whatsappEnabled: dto.whatsappEnabled,
      minimumSeverity: category === ManagerAlertCategory.SECURITY
        ? ManagerAlertSeverity.INFO
        : dto.minimumSeverity,
      quietHoursStart: dto.quietHoursStart,
      quietHoursEnd: dto.quietHoursEnd,
      timezone: dto.timezone,
    };
    const preference = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.managerAlertPreference.upsert({
        where: { gymId_userId_category: { gymId, userId: actor.id, category } },
        create: { gymId, userId: actor.id, category, ...data },
        update: data,
      });
      await this.audit.record({
        gymId, userId: actor.id, action: 'MANAGER_ALERT_PREFERENCE_UPDATED',
        entity: 'ManagerAlertPreference', entityId: saved.id,
        next: { category, emailEnabled: saved.emailEnabled, pushEnabled: saved.pushEnabled, whatsappEnabled: saved.whatsappEnabled, minimumSeverity: saved.minimumSeverity, quietHoursConfigured: Boolean(saved.quietHoursStart) },
      }, tx);
      return saved;
    });
    return preference;
  }

  async policies(actor: any) {
    const gymId = this.requireGym(actor);
    return this.prisma.managerAlertPolicy.findMany({
      where: { gymId },
      orderBy: { category: 'asc' },
      select: {
        category: true, emailAllowed: true, pushAllowed: true,
        whatsappAllowed: true, minimumSeverity: true,
        criticalEscalationMin: true, updatedAt: true,
      },
    });
  }

  async updatePolicy(categoryValue: string, dto: UpdateManagerAlertPolicyDto, actor: any) {
    const gymId = this.requireGym(actor);
    if (!Object.values(ManagerAlertCategory).includes(categoryValue as ManagerAlertCategory)) {
      throw new BadRequestException('Categoria de alerta invalida');
    }
    const category = categoryValue as ManagerAlertCategory;
    if (category === ManagerAlertCategory.SECURITY && dto.minimumSeverity && dto.minimumSeverity !== 'INFO') {
      throw new BadRequestException('Politica de seguranca deve aceitar todas as severidades');
    }
    const data = {
      emailAllowed: dto.emailAllowed,
      pushAllowed: dto.pushAllowed,
      whatsappAllowed: dto.whatsappAllowed,
      minimumSeverity: category === ManagerAlertCategory.SECURITY ? ManagerAlertSeverity.INFO : dto.minimumSeverity,
      criticalEscalationMin: dto.criticalEscalationMin,
    };
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.managerAlertPolicy.upsert({
        where: { gymId_category: { gymId, category } },
        create: { gymId, category, ...data },
        update: data,
      });
      await this.audit.record({
        gymId, userId: actor.id, action: 'MANAGER_ALERT_POLICY_UPDATED',
        entity: 'ManagerAlertPolicy', entityId: saved.id,
        next: { category, emailAllowed: saved.emailAllowed, pushAllowed: saved.pushAllowed, whatsappAllowed: saved.whatsappAllowed, minimumSeverity: saved.minimumSeverity, criticalEscalationMin: saved.criticalEscalationMin },
      }, tx);
      return saved;
    });
  }

  async markRead(alertId: string, actor: any) {
    const gymId = this.requireGym(actor);
    const recipient = await this.requireRecipient(alertId, actor.id, gymId);
    if (!recipient.readAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.managerAlertRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } });
        await this.audit.record({ gymId, userId: actor.id, action: 'MANAGER_ALERT_READ', entity: 'ManagerAlert', entityId: alertId }, tx);
      });
    }
    return { id: alertId, read: true };
  }

  async transition(alertId: string, next: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED', actor: any) {
    const gymId = this.requireGym(actor);
    const recipient = await this.requireRecipient(alertId, actor.id, gymId);
    const current = recipient.alert.status;
    const allowed: Record<ManagerAlertStatus, ManagerAlertStatus[]> = {
      OPEN: [ManagerAlertStatus.ACKNOWLEDGED, ManagerAlertStatus.RESOLVED, ManagerAlertStatus.DISMISSED],
      ACKNOWLEDGED: [ManagerAlertStatus.RESOLVED, ManagerAlertStatus.DISMISSED],
      RESOLVED: [],
      DISMISSED: [],
    };
    const target = ManagerAlertStatus[next];
    if (!allowed[current].includes(target)) {
      throw new BadRequestException(`Transicao ${current} -> ${target} nao permitida`);
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.managerAlert.updateMany({
        where: { id: alertId, gymId, status: current },
        data: target === ManagerAlertStatus.ACKNOWLEDGED
          ? { status: target, acknowledgedAt: now, acknowledgedById: actor.id }
          : target === ManagerAlertStatus.RESOLVED
            ? { status: target, resolvedAt: now, resolvedById: actor.id }
            : { status: target, dismissedAt: now, dismissedById: actor.id },
      });
      if (updated.count !== 1) {
        throw new BadRequestException('Alerta foi alterado por outro usuario; atualize a caixa de entrada.');
      }
      await tx.managerAlertRecipient.update({
        where: { id: recipient.id },
        data: { readAt: recipient.readAt ?? now, ...(target === ManagerAlertStatus.ACKNOWLEDGED ? { acknowledgedAt: now } : {}) },
      });
      await this.audit.record({ gymId, userId: actor.id, action: `MANAGER_ALERT_${target}`, entity: 'ManagerAlert', entityId: alertId, previous: { status: current }, next: { status: target } }, tx);
      return tx.managerAlert.findUniqueOrThrow({ where: { id: alertId } });
    });
  }

  private requireGym(actor: any): string {
    const gymId = actor?.activeGymId ?? actor?.gymId;
    if (!gymId) throw new ForbiddenException('Selecione uma academia para consultar alertas.');
    return gymId;
  }

  private async requireRecipient(alertId: string, userId: string, gymId: string) {
    const recipient = await this.prisma.managerAlertRecipient.findFirst({
      where: { alertId, userId, alert: { gymId } },
      include: { alert: true },
    });
    if (!recipient) throw new NotFoundException('Alerta nao encontrado');
    return recipient;
  }
}
