import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';

@Injectable()
export class WorkoutsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateWorkoutDto, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    const sessions = dto.sessions || [];

    const workout = await this.prisma.workout.create({
      data: {
        studentId: dto.studentId,
        assessmentId: dto.assessmentId,
        goal: dto.goal,
        level: dto.level,
        weeklyFrequency: dto.weeklyFrequency,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes,
        status: 'DRAFT',
        sessions: {
          create: sessions.map((s, si) => ({
            name: s.name,
            sessionType: s.sessionType,
            order: s.order ?? si + 1,
            estimatedMinutes: s.estimatedMinutes,
            exercises: {
              create: (s.exercises || []).map((e, ei) => ({
                exerciseId: e.exerciseId,
                equipmentId: e.equipmentId,
                order: e.order ?? ei + 1,
                sets: e.sets,
                reps: e.reps,
                restSeconds: e.restSeconds,
                suggestedLoad: e.suggestedLoad,
                notes: e.notes,
              })),
            },
          })),
        },
      } as any,
      include: {
        sessions: {
          include: {
            exercises: {
              include: { exercise: true, equipment: true },
            },
          },
        },
      },
    });

    return workout;
  }

  async findAllByStudent(studentId: string, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    return this.prisma.workout.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        sessions: {
          include: {
            exercises: { include: { exercise: true } },
          },
        },
      },
    });
  }

  async findOne(id: string, userGymId?: string) {
    const workout = await this.prisma.workout.findUnique({
      where: { id },
      include: {
        student: true,
        sessions: {
          include: {
            exercises: { include: { exercise: true, equipment: true } },
          },
        },
      },
    });

    if (!workout) {
      throw new NotFoundException('Treino nao encontrado');
    }

    if (userGymId && workout.student.gymId !== userGymId) {
      throw new NotFoundException('Treino nao encontrado');
    }

    return workout;
  }

  async updateStatus(id: string, status: string, userId: string, userGymId?: string) {
    const workout = await this.prisma.workout.findUnique({
      where: { id },
      include: { student: true },
    });

    if (!workout) {
      throw new NotFoundException('Treino nao encontrado');
    }

    if (userGymId && workout.student.gymId !== userGymId) {
      throw new NotFoundException('Treino nao encontrado');
    }

    const allowed = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRED'];

    if (!allowed.includes(status)) {
      throw new BadRequestException('Status invalido');
    }

    const data: any = { status };

    if (status === 'APPROVED' || status === 'ACTIVE') {
      data.approvedById = userId;
    }

    return this.prisma.workout.update({ where: { id }, data });
  }
}
