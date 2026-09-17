import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FinancialReadService {
  constructor(private readonly prisma: PrismaService) {}

  findAllSubscriptions(gymId: string) {
    return this.prisma.subscription.findMany({
      where: { gymId },
      include: { student: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
