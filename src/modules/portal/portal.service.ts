import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PortalService {
  constructor(private prisma: PrismaService) {}

  private async getStudentByUserId(userId: string) {
    const student = await this.prisma.student.findFirst({
      where: { userId },
      include: { gym: true, user: true },
    });

    if (!student) {
      throw new NotFoundException('Perfil de aluno nao encontrado para este usuario');
    }

    return student;
  }

  async getProfile(userId: string) {
    const s = await this.getStudentByUserId(userId);

    return {
      id: s.id,
      name: s.user ? s.user.name : null,
      email: s.user ? s.user.email : null,
      phone: s.user ? s.user.phone : null,
      gym: { id: s.gym.id, name: s.gym.name, slug: s.gym.slug, logoUrl: s.gym.logoUrl },
      status: s.status,
      enrollmentDate: s.enrollmentDate,
      goal: s.goal,
      level: s.level,
    };
  }

  async getWorkouts(userId: string) {
    const s = await this.getStudentByUserId(userId);

    return this.prisma.workout.findMany({
      where: { studentId: s.id, status: { in: ['APPROVED', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        sessions: {
          orderBy: { order: 'asc' },
          include: {
            exercises: {
              orderBy: { order: 'asc' },
              include: { exercise: true, equipment: true },
            },
          },
        },
      },
    });
  }

  async getAssessments(userId: string) {
    const s = await this.getStudentByUserId(userId);

    return this.prisma.assessment.findMany({
      where: { studentId: s.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSchedules(userId: string) {
    const s = await this.getStudentByUserId(userId);

    return this.prisma.studentSchedule.findMany({
      where: { studentId: s.id },
      orderBy: { date: 'desc' },
      take: 30,
      include: { slot: true },
    });
  }

  async getCharges(userId: string) {
    const s = await this.getStudentByUserId(userId);

    return this.prisma.charge.findMany({
      where: { studentId: s.id },
      orderBy: { dueDate: 'desc' },
      take: 30,
    });
  }

  async checkIn(userId: string) {
    const s = await this.getStudentByUserId(userId);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const booking = await this.prisma.studentSchedule.findFirst({
      where: {
        studentId: s.id,
        status: 'SCHEDULED',
        date: { gte: startOfDay, lte: endOfDay },
      },
      include: { slot: true },
    });

    if (!booking) {
      throw new BadRequestException('Nenhum agendamento para hoje');
    }

    return this.prisma.studentSchedule.update({
      where: { id: booking.id },
      data: { status: 'CHECKED_IN', checkedInAt: new Date() } as any,
      include: { slot: true },
    });
  }
}
