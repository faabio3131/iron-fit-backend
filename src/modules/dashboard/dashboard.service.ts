import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private gymFilter(userGymId?: string) {
    return userGymId ? { gymId: userGymId } : {};
  }

  async getSummary(userGymId?: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const studentWhere: any = { ...this.gymFilter(userGymId) };
    const activeStudentWhere: any = { status: 'ACTIVE', ...this.gymFilter(userGymId) };
    const equipmentWhere: any = { active: true, ...this.gymFilter(userGymId) };

    const revenueWhere: any = {
      type: 'INCOME',
      status: 'PAID',
      paidAt: { gte: startOfMonth, lte: endOfMonth },
      ...this.gymFilter(userGymId),
    };

    const chargePendingWhere: any = { status: 'PENDING', ...this.gymFilter(userGymId) };
    const chargeOverdueWhere: any = {
      status: 'PENDING',
      dueDate: { lt: now },
      ...this.gymFilter(userGymId),
    };

    const workoutWhere: any = userGymId ? { student: { gymId: userGymId } } : {};
    const workoutApprovedWhere: any = {
      status: { in: ['APPROVED', 'ACTIVE'] },
      ...(userGymId ? { student: { gymId: userGymId } } : {}),
    };

    const totalStudents = await this.prisma.student.count({ where: studentWhere });
    const activeStudents = await this.prisma.student.count({ where: activeStudentWhere });
    const totalEquipments = await this.prisma.equipment.count({ where: equipmentWhere });

    const revenueThisMonth = await this.prisma.financialTransaction.aggregate({
      where: revenueWhere,
      _sum: { amount: true },
    });

    const pendingCharges = await this.prisma.charge.count({ where: chargePendingWhere });
    const overdueCharges = await this.prisma.charge.count({ where: chargeOverdueWhere });
    const totalWorkouts = await this.prisma.workout.count({ where: workoutWhere });
    const approvedWorkouts = await this.prisma.workout.count({ where: workoutApprovedWhere });

    return {
      students: {
        total: totalStudents,
        active: activeStudents,
        inactive: totalStudents - activeStudents,
      },
      equipments: { total: totalEquipments },
      revenue: { thisMonth: revenueThisMonth._sum.amount || 0 },
      charges: { pending: pendingCharges, overdue: overdueCharges },
      workouts: {
        total: totalWorkouts,
        approved: approvedWorkouts,
        drafts: totalWorkouts - approvedWorkouts,
      },
      generatedAt: now,
    };
  }

  async getRevenueByDay(userGymId?: string, days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const transactions = await this.prisma.financialTransaction.findMany({
      where: {
        type: 'INCOME',
        status: 'PAID',
        paidAt: { gte: since },
        ...this.gymFilter(userGymId),
      },
      select: { paidAt: true, amount: true },
    });

    const byDay: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDay[d.toISOString().split('T')[0]] = 0;
    }

    for (const t of transactions) {
      if (t.paidAt) {
        const key = t.paidAt.toISOString().split('T')[0];
        if (byDay[key] !== undefined) byDay[key] += t.amount;
      }
    }

    return Object.entries(byDay)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getAttendance(userGymId?: string, days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const checkins = await this.prisma.studentSchedule.findMany({
      where: {
        status: 'CHECKED_IN',
        checkedInAt: { gte: since },
        ...(userGymId ? { student: { gymId: userGymId } } : {}),
      } as any,
      select: { checkedInAt: true },
    });

    const byDay: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDay[d.toISOString().split('T')[0]] = 0;
    }

    for (const c of checkins) {
      if (c.checkedInAt) {
        const key = c.checkedInAt.toISOString().split('T')[0];
        if (byDay[key] !== undefined) byDay[key] += 1;
      }
    }

    return Object.entries(byDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getOverdueCharges(userGymId?: string) {
    const now = new Date();
    return this.prisma.charge.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lt: now },
        ...this.gymFilter(userGymId),
      },
      include: { student: { include: { user: true } } },
      orderBy: { dueDate: 'asc' },
      take: 20,
    });
  }

  async getUpcomingBirthdays(userGymId?: string, days: number = 30) {
    const now = new Date();
    const students = await this.prisma.student.findMany({
      where: {
        birthDate: { not: null },
        status: 'ACTIVE',
        ...this.gymFilter(userGymId),
      },
      include: { user: true },
    });

    const result: any[] = [];
    for (const s of students) {
      if (!s.birthDate) continue;
      const birth = new Date(s.birthDate);
      const next = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
      if (next < now) next.setFullYear(now.getFullYear() + 1);
      const diffDays = Math.ceil(
        (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays <= days) {
        result.push({
          studentId: s.id,
          name: s.user ? s.user.name : 'Sem nome',
          birthDate: s.birthDate,
          nextBirthday: next,
          daysUntil: diffDays,
          age: next.getFullYear() - birth.getFullYear(),
        });
      }
    }
    return result.sort((a, b) => a.daysUntil - b.daysUntil);
  }
}
