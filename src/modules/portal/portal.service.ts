import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UpdateMyCommunicationPreferencesDto } from './dto/update-my-communication-preferences.dto';

@Injectable()
export class PortalService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async getStudentByUserId(userId: string, gymId?: string | null) {
    if (!gymId) {
      throw new NotFoundException('Perfil de aluno nao encontrado para este usuario');
    }

    const student = await this.prisma.student.findFirst({
      where: {
        userId,
        gymId,
      },
      include: { gym: true, user: true },
    });

    if (!student) {
      throw new NotFoundException('Perfil de aluno nao encontrado para este usuario');
    }

    return student;
  }

  async getProfile(userId: string, gymId?: string | null) {
    const s = await this.getStudentByUserId(userId, gymId);

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

  async getWorkouts(userId: string, gymId?: string | null) {
    const s = await this.getStudentByUserId(userId, gymId);

    return this.prisma.workout.findMany({
      where: {
        studentId: s.id,
        student: { gymId: s.gymId, userId },
        status: { in: ['APPROVED', 'ACTIVE'] },
      },
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

  async getAssessments(userId: string, gymId?: string | null) {
    const s = await this.getStudentByUserId(userId, gymId);

    return this.prisma.assessment.findMany({
      where: {
        studentId: s.id,
        student: { gymId: s.gymId, userId },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSchedules(userId: string, gymId?: string | null) {
    const s = await this.getStudentByUserId(userId, gymId);

    return this.prisma.studentSchedule.findMany({
      where: {
        studentId: s.id,
        student: { gymId: s.gymId, userId },
        slot: { gymId: s.gymId },
      },
      orderBy: { date: 'desc' },
      take: 30,
      include: { slot: true },
    });
  }

  async getCommunicationPreferences(userId: string, gymId?: string | null) {
    const s = await this.getStudentByUserId(userId, gymId);
    const existing = await this.prisma.communicationPreference.findUnique({
      where: { studentId: s.id },
    });

    return {
      studentId: s.id,
      consentComm: s.consentComm,
      configured: existing !== null,
      pushEnabled: existing?.pushEnabled ?? true,
      inAppEnabled: existing?.inAppEnabled ?? true,
      emailEnabled: existing?.emailEnabled ?? false,
      whatsappEnabled: existing?.whatsappEnabled ?? false,
      trainingReminders: existing?.trainingReminders ?? true,
      paymentReminders: existing?.paymentReminders ?? true,
      marketing: existing?.marketing ?? false,
    };
  }

  async updateCommunicationPreferences(
    userId: string,
    dto: UpdateMyCommunicationPreferencesDto,
    gymId?: string | null,
  ) {
    const s = await this.getStudentByUserId(userId, gymId);
    const previous = await this.prisma.communicationPreference.findUnique({
      where: { studentId: s.id },
    });

    const nextValues = {
      pushEnabled: dto.pushEnabled ?? previous?.pushEnabled ?? true,
      inAppEnabled: dto.inAppEnabled ?? previous?.inAppEnabled ?? true,
      emailEnabled: dto.emailEnabled ?? previous?.emailEnabled ?? false,
      whatsappEnabled: dto.whatsappEnabled ?? previous?.whatsappEnabled ?? false,
      trainingReminders:
        dto.trainingReminders ?? previous?.trainingReminders ?? true,
      paymentReminders:
        dto.paymentReminders ?? previous?.paymentReminders ?? true,
      marketing: dto.marketing ?? previous?.marketing ?? false,
    };

    const updated = await this.prisma.communicationPreference.upsert({
      where: { studentId: s.id },
      create: {
        studentId: s.id,
        ...nextValues,
      },
      update: nextValues,
    });

    await this.audit.record({
      gymId: s.gymId,
      userId,
      action: 'STUDENT_COMMUNICATION_PREFERENCES_UPDATED',
      entity: 'CommunicationPreference',
      entityId: updated.id,
      previous: previous
        ? {
            pushEnabled: previous.pushEnabled,
            inAppEnabled: previous.inAppEnabled,
            emailEnabled: previous.emailEnabled,
            whatsappEnabled: previous.whatsappEnabled,
            trainingReminders: previous.trainingReminders,
            paymentReminders: previous.paymentReminders,
            marketing: previous.marketing,
          }
        : null,
      next: nextValues,
    });

    return {
      studentId: s.id,
      consentComm: s.consentComm,
      configured: true,
      ...nextValues,
    };
  }

  async getCharges(userId: string, gymId?: string | null) {
    const s = await this.getStudentByUserId(userId, gymId);

    return this.prisma.charge.findMany({
      where: {
        studentId: s.id,
        gymId: s.gymId,
        student: { userId },
      },
      orderBy: { dueDate: 'desc' },
      take: 30,
    });
  }

  async checkIn(userId: string, gymId?: string | null) {
    const s = await this.getStudentByUserId(userId, gymId);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const booking = await this.prisma.studentSchedule.findFirst({
      where: {
        studentId: s.id,
        student: { gymId: s.gymId, userId },
        slot: { gymId: s.gymId },
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
