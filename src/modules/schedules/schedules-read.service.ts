import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SchedulesReadService {
  constructor(private readonly prisma: PrismaService) {}

  findAllBookings(gymId: string) {
    return this.prisma.studentSchedule.findMany({
      where: {
        student: { gymId },
        slot: { gymId },
      },
      include: {
        student: { include: { user: true } },
        slot: true,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }
}
