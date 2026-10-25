import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    if (!gymId) {
      throw new NotFoundException('Perfil de aluno nao encontrado para este usuario');
    }

    // Only user-supplied fields are mutable. Reconstructing all seven values
    // from a stale read would undo concurrent student preference changes.
    const fields: (keyof UpdateMyCommunicationPreferencesDto)[] = [
      'pushEnabled', 'inAppEnabled', 'emailEnabled', 'whatsappEnabled',
      'trainingReminders', 'paymentReminders', 'marketing',
    ];
    const changes: Partial<UpdateMyCommunicationPreferencesDto> = {};
    for (const key of fields) {
      if (typeof dto[key] === 'boolean') {
        changes[key] = dto[key];
      }
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Informe ao menos uma preferencia para atualizar');
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const s = await tx.student.findFirst({
            where: { userId, gymId },
            select: { id: true, gymId: true, consentComm: true },
          });
          if (!s) {
            throw new NotFoundException('Perfil de aluno nao encontrado para este usuario');
          }
          const previous = await tx.communicationPreference.findUnique({
            where: { studentId: s.id },
          });

          const updated = await tx.communicationPreference.upsert({
            where: { studentId: s.id },
            create: {
              studentId: s.id,
              pushEnabled: true,
              inAppEnabled: true,
              emailEnabled: false,
              whatsappEnabled: false,
              trainingReminders: true,
              paymentReminders: true,
              marketing: false,
              ...changes,
            },
            update: changes,
          });

          const previousValues = previous ? {
            pushEnabled: previous.pushEnabled,
            inAppEnabled: previous.inAppEnabled,
            emailEnabled: previous.emailEnabled,
            whatsappEnabled: previous.whatsappEnabled,
            trainingReminders: previous.trainingReminders,
            paymentReminders: previous.paymentReminders,
            marketing: previous.marketing,
          } : null;

          await this.audit.record({
            gymId: s.gymId,
            userId,
            action: 'STUDENT_COMMUNICATION_PREFERENCES_UPDATED',
            entity: 'CommunicationPreference',
            entityId: updated.id,
            previous: previousValues,
            next: {
              pushEnabled: updated.pushEnabled,
              inAppEnabled: updated.inAppEnabled,
              emailEnabled: updated.emailEnabled,
              whatsappEnabled: updated.whatsappEnabled,
              trainingReminders: updated.trainingReminders,
              paymentReminders: updated.paymentReminders,
              marketing: updated.marketing,
            },
          }, tx);

          return {
            studentId: s.id,
            consentComm: s.consentComm,
            configured: true,
            pushEnabled: updated.pushEnabled,
            inAppEnabled: updated.inAppEnabled,
            emailEnabled: updated.emailEnabled,
            whatsappEnabled: updated.whatsappEnabled,
            trainingReminders: updated.trainingReminders,
            paymentReminders: updated.paymentReminders,
            marketing: updated.marketing,
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error: any) {
        // A concurrent insert or Serializable conflict may be retried; never
        // confirm a preference until the transaction and audit commit.
        if (error?.code === 'P2034' || error?.code === 'P2002') {
          if (attempt < 2) continue;
          throw new ConflictException('Preferencias alteradas em outra operacao; tente novamente');
        }
        throw error;
      }
    }
    throw new ConflictException('Preferencias alteradas em outra operacao; tente novamente');
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
    if (s.status !== 'ACTIVE') {
      throw new BadRequestException('Matricula inativa nao permite check-in');
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await tx.studentSchedule.findFirst({
          where: {
            studentId: s.id,
            student: { gymId: s.gymId, userId, status: 'ACTIVE' },
            slot: { gymId: s.gymId },
            status: 'SCHEDULED',
            date: { gte: startOfDay, lte: endOfDay },
          },
          include: { slot: true },
        });

        if (!booking) {
          throw new BadRequestException('Nenhum agendamento para hoje');
        }

        // The canonical booking status and tenant membership are rechecked
        // on the write: concurrent requests cannot register twice.
        const updated = await tx.studentSchedule.update({
          where: {
            id: booking.id,
            studentId: s.id,
            status: 'SCHEDULED',
            student: { gymId: s.gymId, userId, status: 'ACTIVE' },
            slot: { gymId: s.gymId },
          },
          data: { status: 'CHECKED_IN', checkedInAt: new Date() },
          include: { slot: true },
        });

        await this.audit.record({
          gymId: s.gymId,
          userId,
          action: 'STUDENT_SELF_CHECK_IN',
          entity: 'StudentSchedule',
          entityId: updated.id,
          previous: { status: 'SCHEDULED' },
          next: { status: updated.status, checkedInAt: updated.checkedInAt },
        }, tx);

        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: any) {
      if (error?.code === 'P2025' || error?.code === 'P2034') {
        throw new BadRequestException('Agendamento nao pode receber check-in; atualize sua agenda');
      }
      throw error;
    }
  }

}
