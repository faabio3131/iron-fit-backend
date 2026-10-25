import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const ADMIN_STEP_UP_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class StepUpService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(userId: string, sessionId: string) {
    const expiresAt = new Date(Date.now() + ADMIN_STEP_UP_TTL_MS);
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { stepUpExpiresAt: expiresAt },
    });
    if (result.count !== 1) {
      throw new UnauthorizedException('Sessao invalida');
    }
    return { active: true, expiresAt };
  }

  async status(userId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { stepUpExpiresAt: true },
    });
    const expiresAt = session?.stepUpExpiresAt ?? null;
    return {
      active: Boolean(expiresAt && expiresAt > new Date()),
      expiresAt,
    };
  }

  async assertActive(userId: string, sessionId: string) {
    const state = await this.status(userId, sessionId);
    if (!state.active) {
      throw new ForbiddenException('Reautenticacao administrativa necessaria');
    }
    return state;
  }
}
