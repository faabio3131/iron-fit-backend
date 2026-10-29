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
