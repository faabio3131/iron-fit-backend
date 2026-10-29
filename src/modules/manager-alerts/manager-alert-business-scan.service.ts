import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';
import { ManagerAlertProducersService } from './manager-alert-producers.service';

@Injectable()
export class ManagerAlertBusinessScanService {
  private equipmentCursor?: string;
  private attendanceCursor?: string;
  private trialCursor?: string;
  private incidentCursor?: string;
  private escalationCursor?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producers: ManagerAlertProducersService,
    private readonly entitlements: TenantProductEntitlementsService,
    private readonly config: ConfigService,
  ) {}

  private setting(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key));
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }

  async scanDue(take = 50, now = new Date()) {
    take = Math.min(Math.max(Math.trunc(take) || 1, 1), 100);
    const results = await Promise.allSettled([
      this.equipment(take), this.attendance(take, now), this.trials(take, now), this.incidents(take), this.escalations(take, now),
    ]);
    if (results.some((result) => result.status === 'rejected')) throw new Error('MANAGER_ALERT_BUSINESS_SCAN_FAILED');
  }

  private async equipment(take: number) {
    const rows = await this.prisma.equipment.findMany({
      where: {
        operationalStatus: { in: ['MAINTENANCE', 'OUT_OF_SERVICE'] },
        operationalStatusChangedAt: { not: null },
        ...(this.equipmentCursor ? { id: { gt: this.equipmentCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, operationalStatusChangedAt: true },
    });
    for (const row of rows) {
      await this.producers.equipmentProblem({ gymId: row.gymId, eventId: `${row.id}:${row.operationalStatusChangedAt!.toISOString()}`, resourceId: row.id, occurredAt: row.operationalStatusChangedAt! });
      this.equipmentCursor = row.id;
    }
    if (rows.length < take) this.equipmentCursor = undefined;
  }

  private async attendance(take: number, now: Date) {
    const days = this.setting('MANAGER_ALERT_ATTENDANCE_INACTIVITY_DAYS', 14, 7, 90);
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.prisma.student.findMany({
      where: {
        status: 'ACTIVE', gym: { active: true },
        // No history means unknown attendance, not zero. Use both canonical presence sources.
        OR: [{ accessEvents: { some: { allowed: true } } }, { schedules: { some: { checkedInAt: { not: null } } } }],
        accessEvents: { none: { allowed: true, occurredAt: { gte: cutoff } } },
        schedules: { none: { checkedInAt: { gte: cutoff } } },
        ...(this.attendanceCursor ? { id: { gt: this.attendanceCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: {
        id: true, gymId: true,
        accessEvents: { where: { allowed: true }, orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
        schedules: { where: { checkedInAt: { not: null } }, orderBy: { checkedInAt: 'desc' }, take: 1, select: { checkedInAt: true } },
      },
    });
    for (const row of rows) {
      const last = Math.max(row.accessEvents[0]?.occurredAt.getTime() ?? 0, row.schedules[0]?.checkedInAt?.getTime() ?? 0);
      if (last > 0 && last < cutoff.getTime()) {
        await this.producers.attendanceRisk({ gymId: row.gymId, eventId: `${row.id}:${last}:${days}`, resourceId: row.id, occurredAt: new Date(last), summary: `Aluno com presença anterior sem novos registros de acesso ou check-in há pelo menos ${days} dias. Sinal de acompanhamento, sem afirmar cancelamento.` });
      }
      this.attendanceCursor = row.id;
    }
    if (rows.length < take) this.attendanceCursor = undefined;
  }

  private async trials(take: number, now: Date) {
    const threshold = this.setting('MANAGER_ALERT_PLAN_THRESHOLD_PERCENT', 80, 1, 100);
    const rows = await this.prisma.commercialTrialProvisioning.findMany({
      where: { trialEndsAt: { gt: now }, ...(this.trialCursor ? { requestId: { gt: this.trialCursor } } : {}) },
      orderBy: { requestId: 'asc' }, take,
      select: { requestId: true, gymId: true, subscriptionId: true },
    });
    for (const row of rows) {
      const subscription = await this.prisma.tenantProductSubscription.findFirst({
        where: { id: row.subscriptionId, gymId: row.gymId, status: 'ACTIVE', effectiveFrom: { lte: now }, effectiveUntil: { gt: now } },
        select: { id: true },
      });
      if (subscription) {
        const resolution = await this.entitlements.resolveFeature(row.gymId, 'commercial.trial_students_max');
        if (resolution.kind !== 'LIMIT' || typeof resolution.value !== 'number' || !Number.isInteger(resolution.value) || resolution.value < 1) {
          throw new Error('MANAGER_ALERT_TRIAL_LIMIT_UNAVAILABLE');
        }
        const usage = await this.prisma.student.count({ where: { gymId: row.gymId, status: { not: 'CANCELED' } } });
        if (usage * 100 >= resolution.value * threshold) {
          await this.producers.planLimitNear({ gymId: row.gymId, eventId: `${subscription.id}:commercial.trial_students_max:${resolution.value}:${threshold}`, resourceId: subscription.id, summary: `O trial utiliza ${usage} de ${resolution.value} vagas de alunos; atingiu o limiar de acompanhamento de ${threshold}%.` });
        }
      }
      this.trialCursor = row.requestId;
    }
    if (rows.length < take) this.trialCursor = undefined;
  }

  private async incidents(take: number) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        gymId: { not: null },
        // Existing domain failures only; never ingest alert-dispatch errors (feedback loop).
        action: { in: ['AGGREGATOR_PROVISIONAL_REVALIDATION_FAILED', 'MEDIA_INGESTION_FAILED'] },
        ...(this.incidentCursor ? { id: { gt: this.incidentCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, entity: true, entityId: true, createdAt: true },
    });
    for (const row of rows) {
      await this.producers.operationalIncident({ gymId: row.gymId!, eventId: `audit:${row.id}`, resourceId: row.entityId ?? row.id, resourceType: row.entity, occurredAt: row.createdAt });
      this.incidentCursor = row.id;
    }
    if (rows.length < take) this.incidentCursor = undefined;
  }

  private async escalations(take: number, now: Date) {
    const rows = await this.prisma.managerAlert.findMany({
      where: {
        severity: 'CRITICAL', status: 'OPEN', acknowledgedAt: null,
        eventKey: { not: 'manager.alert.escalated' },
        createdAt: { lte: new Date(now.getTime() - 5 * 60_000) },
        ...(this.escalationCursor ? { id: { gt: this.escalationCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, category: true, createdAt: true },
    });
    for (const row of rows) {
      const policy = await this.prisma.managerAlertPolicy.findUnique({ where: { gymId_category: { gymId: row.gymId, category: row.category } }, select: { criticalEscalationMin: true } });
      const minutes = policy?.criticalEscalationMin;
      if (minutes && minutes >= 5 && minutes <= 1440 && now.getTime() - row.createdAt.getTime() >= minutes * 60_000) {
        await this.producers.criticalEscalation({ gymId: row.gymId, eventId: row.id, resourceId: row.id }, row.category);
      }
      this.escalationCursor = row.id;
    }
    if (rows.length < take) this.escalationCursor = undefined;
  }
}
