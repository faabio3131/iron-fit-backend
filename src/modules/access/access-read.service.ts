import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccessReadService {
  constructor(private readonly prisma: PrismaService) {}

  findRecentEvents(gymId: string, limit = 100) {
    const take = Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 100, 200));
    return this.prisma.accessEvent.findMany({
      where: { gymId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
