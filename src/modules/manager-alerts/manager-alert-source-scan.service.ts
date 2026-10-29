import { Injectable } from '@nestjs/common';
import { ChargeStatus, WorkoutStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ManagerAlertProducersService } from './manager-alert-producers.service';

/** Reconcile committed domain facts. Replays after restart use canonical deduplication. */
@Injectable()
export class ManagerAlertSourceScanService {
  private chargeCursor: string | undefined;
  private workoutCursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producers: ManagerAlertProducersService,
  ) {}

  async scanDue(limit = 50, now = new Date()) {
    const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100);
    const charges = await this.prisma.charge.findMany({
      where: {
        status: { in: [ChargeStatus.PENDING, ChargeStatus.EXPIRED] },
        paidAt: null,
        dueDate: { lt: now },
        ...(this.chargeCursor ? { id: { gt: this.chargeCursor } } : {}),
      },
      orderBy: { id: 'asc' }, take,
      select: { id: true, gymId: true, dueDate: true },
    });
    for (const charge of charges) {
      await this.producers.overdueStudentCharge({
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
}
