import { Injectable } from '@nestjs/common';
import { ChargeStatus, WorkoutStatus, MessageStatus, IntegrationScope, IntegrationConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ManagerAlertProducersService } from './manager-alert-producers.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';

/** Reconcile committed domain facts. Replays after restart use canonical deduplication. */
@Injectable()
export class ManagerAlertSourceScanService {
  private chargeCursor: string | undefined;
  private workoutCursor: string | undefined;
  private messageCursor: string | undefined;
  private integrationCursor: string | undefined;
  private accessCursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producers: ManagerAlertProducersService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
  ) {}

  async scanDue(limit = 50, now = new Date()) {
    const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100);
    const results = await Promise.allSettled([
      this.scanCore(take, now), this.scanMessages(take),
      this.scanIntegrations(take), this.scanAccess(take),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('MANAGER_ALERT_SOURCE_SCAN_FAILED');
    }
    const values = results.map((result) => result.status === 'fulfilled' ? result.value : null);
    return { ...(values[0] as { charges: number; workouts: number }), messages: values[1], integrations: values[2], suspiciousAccesses: values[3] };
  }

  private async scanCore(take: number, now: Date) {
    const charges = await this.prisma.charge.findMany({
      where: {
        paidAt: null,
        OR: [
          { status: { in: [ChargeStatus.PENDING, ChargeStatus.EXPIRED] }, dueDate: { lt: now } },
          { status: ChargeStatus.FAILED },
        ],
        ...(this.chargeCursor ? { id: { gt: this.chargeCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, dueDate: true, status: true },
    });
    for (const charge of charges) {
      if (charge.status === ChargeStatus.FAILED) {
        await this.producers.paymentFailure({ gymId: charge.gymId, eventId: charge.id, resourceId: charge.id });
      } else await this.producers.overdueStudentCharge({
        gymId: charge.gymId,
        eventId: `${charge.id}:${charge.dueDate!.toISOString()}`,
        resourceId: charge.id,
        occurredAt: charge.dueDate!,
      });
      // Advance only after durable ingest; failures retry on the next cycle.
      this.chargeCursor = charge.id;
    }
    if (charges.length < take) this.chargeCursor = undefined;

    const workouts = await this.prisma.workout.findMany({
      where: {
        status: WorkoutStatus.PENDING_REVIEW,
        ...(this.workoutCursor ? { id: { gt: this.workoutCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, createdByAI: true, createdAt: true, student: { select: { gymId: true } } },
    });
    for (const workout of workouts) {
      const event = {
        gymId: workout.student.gymId,
        eventId: workout.id,
        resourceId: workout.id,
        occurredAt: workout.createdAt,
      };
      await this.producers.assessmentOrWorkoutPending(event);
      if (workout.createdByAI) await this.producers.humanApprovalPending(event);
      this.workoutCursor = workout.id;
    }
    if (workouts.length < take) this.workoutCursor = undefined;
    return { charges: charges.length, workouts: workouts.length };
  }

  private async scanMessages(take: number) {
    const rows = await this.prisma.communicationMessage.findMany({
      where: {
        status: MessageStatus.FAILED,
        channel: { in: ['EMAIL', 'WHATSAPP'] },
        ...(this.messageCursor ? { id: { gt: this.messageCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, createdAt: true },
    });
    for (const row of rows) {
      await this.producers.deliveryFailure({ gymId: row.gymId, eventId: `communication:${row.id}`, resourceId: row.id, resourceType: 'CommunicationMessage', occurredAt: row.createdAt });
      this.messageCursor = row.id;
    }
    if (rows.length < take) this.messageCursor = undefined;
    return rows.length;
  }

  private async scanIntegrations(take: number) {
    const rows = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.TENANT,
        gymId: { not: null },
        environment: this.runtime.current(),
        // Intentional disconnect/suspension is not evidence of an incident.
        status: IntegrationConnectionStatus.DEGRADED,
        ...(this.integrationCursor ? { id: { gt: this.integrationCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, updatedAt: true },
    });
    for (const row of rows) {
      await this.producers.integrationDegraded({ gymId: row.gymId!, eventId: `${row.id}:${row.updatedAt.toISOString()}`, resourceId: row.id, occurredAt: row.updatedAt });
      this.integrationCursor = row.id;
    }
    if (rows.length < take) this.integrationCursor = undefined;
    return rows.length;
  }

  private async scanAccess(take: number) {
    const rows = await this.prisma.accessEvent.findMany({
      where: {
        allowed: false,
        // Ordinary financial/plan denials must not be labelled attacks.
        denialReason: { in: ['Replay detectado', 'Autenticacao do dispositivo invalida'] },
        ...(this.accessCursor ? { id: { gt: this.accessCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, occurredAt: true },
    });
    for (const row of rows) {
      await this.producers.suspiciousAccess({ gymId: row.gymId, eventId: `access:${row.id}`, resourceId: row.id, resourceType: 'AccessEvent', occurredAt: row.occurredAt });
      this.accessCursor = row.id;
    }
    if (rows.length < take) this.accessCursor = undefined;
    return rows.length;
  }
}
