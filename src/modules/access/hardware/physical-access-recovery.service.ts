import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Lifecycle recovery does not emit device commands. It only closes stale
 * authorizations and quarantines uncertain releases for operator review.
 */
@Injectable()
export class PhysicalAccessRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhysicalAccessRecoveryService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  onModuleInit() {
    this.interval = setInterval(() => {
      void this.expireStale().catch(() => {
        this.logger.warn('Falha na reconciliação de liberações físicas; acesso não será reaberto');
      });
    }, 60_000);
    this.interval.unref?.();
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  constructor(private readonly prisma: PrismaService) {}

  async expireStale(now: Date = new Date()): Promise<{
    expired: number;
    uncertain: number;
  }> {
    if (!Number.isFinite(now.getTime())) throw new Error('Data de recuperacao invalida');
    const uncertain = await this.prisma.physicalAccessAttempt.updateMany({
      where: { state: 'RELEASE_IN_FLIGHT', expiresAt: { lt: now } },
      data: { state: 'RELEASE_UNCERTAIN' },
    });
    const expired = await this.prisma.physicalAccessAttempt.updateMany({
      where: {
        state: { in: ['REQUESTED', 'AUTHORIZED', 'COMMAND_ACCEPTED'] },
        expiresAt: { lt: now },
      },
      data: { state: 'EXPIRED' },
    });
    return { expired: expired.count, uncertain: uncertain.count };
  }

  /** Tenant-scoped operational read; excludes SDK secrets and raw credentials. */
  async listUncertain(gymId: string, limit = 100) {
    if (!gymId) throw new Error('Academia obrigatoria');
    const take = Math.max(1, Math.min(limit, 100));
    return this.prisma.physicalAccessAttempt.findMany({
      where: { gymId, state: 'RELEASE_UNCERTAIN' },
      select: {
        id: true,
        authorizationId: true,
        deviceId: true,
        manufacturer: true,
        direction: true,
        state: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
  async listRecent(gymId: string, limit = 100) {
    if (!gymId) throw new Error('Academia obrigatoria');
    return this.prisma.physicalAccessAttempt.findMany({
      where: { gymId },
      select: {
        id: true,
        studentId: true,
        deviceId: true,
        manufacturer: true,
        direction: true,
        state: true,
        denialReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

}
