import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { findEquipmentExerciseMapping } from '../../common/equipment/equipment-exercise-mapping';
import { CreateWorkoutDto } from './dto/create-workout.dto';

@Injectable()
export class WorkoutsService {
  private readonly audit: AuditService;

  constructor(private prisma: PrismaService) {
    this.audit = new AuditService(prisma);
  }

  private requireGymId(userGymId?: string) {
    if (!userGymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return userGymId;
  }

  async findAll(userGymId?: string) {
    const gymId = this.requireGymId(userGymId);
    return this.prisma.workout.findMany({
      where: { student: { gymId } },
      orderBy: { createdAt: 'desc' },
      include: {
        student: { include: { user: true } },
        sessions: {
          include: {
            exercises: { include: { exercise: true, equipment: true } },
          },
        },
      },
    });
  }

  async create(
    dto: CreateWorkoutDto,
    userGymId?: string,
    actorUserId?: string,
  ) {
    const gymId = this.requireGymId(userGymId);
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        gymId,
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    if (dto.assessmentId) {
      const assessment = await this.prisma.assessment.findFirst({
        where: {
          id: dto.assessmentId,
          studentId: dto.studentId,
          student: { gymId },
        },
      });
      if (!assessment) {
        throw new NotFoundException('Avaliacao nao encontrada');
      }
    }

    const sessions = dto.sessions || [];
    const exerciseIds = [
      ...new Set(
        sessions.flatMap((session) =>
          (session.exercises || []).map((exercise) => exercise.exerciseId),
        ),
      ),
    ];
    const equipmentIds = [
      ...new Set(
        sessions.flatMap((session) =>
          (session.exercises || [])
            .map((exercise) => exercise.equipmentId)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];

    const exercises = exerciseIds.length > 0
      ? await this.prisma.exercise.findMany({
          where: { id: { in: exerciseIds } },
          select: { id: true, name: true },
        })
      : [];
    if (exercises.length !== exerciseIds.length) {
      throw new NotFoundException('Exercicio nao encontrado');
    }

    const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

    if (equipmentIds.length > 0) {
      const [scopedEquipment, canonicalCatalog] = await Promise.all([
        this.prisma.equipment.findMany({
          where: { id: { in: equipmentIds }, gymId, active: true },
          select: {
            id: true,
            catalogItemId: true,
            catalogItem: {
              select: {
                id: true,
                active: true,
                metadata: true,
              },
            },
          },
        }),
        this.prisma.equipmentCatalogItem.findMany({
          where: { active: true },
          select: { id: true, metadata: true },
        }),
      ]);

      if (scopedEquipment.length !== equipmentIds.length) {
        throw new NotFoundException('Equipamento nao encontrado');
      }

      const equipmentById = new Map(scopedEquipment.map((equipment) => [equipment.id, equipment]));
      const compatibleCatalogByExercise = new Map<string, Set<string>>();
      for (const exercise of exercises) {
        const compatibleCatalogIds = new Set(
          canonicalCatalog
            .filter((item) =>
              Boolean(findEquipmentExerciseMapping(item.metadata, exercise.id, exercise.name)),
            )
            .map((item) => item.id),
        );
        compatibleCatalogByExercise.set(exercise.id, compatibleCatalogIds);
      }

      for (const session of sessions) {
        for (const workoutExercise of session.exercises || []) {
          if (!workoutExercise.equipmentId) continue;

          const equipment = equipmentById.get(workoutExercise.equipmentId);
          const exercise = exerciseById.get(workoutExercise.exerciseId);
          if (!equipment || !exercise) {
            throw new NotFoundException('Exercicio ou equipamento nao encontrado');
          }

          if (!equipment.catalogItemId) {
            continue;
          }

          if (!equipment.catalogItem?.active) {
            throw new BadRequestException('Capacidade canonica do equipamento esta inativa');
          }

          const knownCompatibleCatalog = compatibleCatalogByExercise.get(exercise.id) ?? new Set<string>();
          if (
            knownCompatibleCatalog.size > 0 &&
            !knownCompatibleCatalog.has(equipment.catalogItemId)
          ) {
            throw new BadRequestException(
              `Equipamento incompativel com o exercicio ${exercise.name}`,
            );
          }
        }
      }
    }

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

    await this.audit.record({
      gymId,
      userId: actorUserId ?? null,
      action: 'WORKOUT_CREATED',
      entity: 'Workout',
      entityId: workout.id,
      next: {
        studentId: workout.studentId,
        assessmentId: workout.assessmentId,
        status: workout.status,
        weeklyFrequency: workout.weeklyFrequency,
      },
    });

    return workout;
  }

  async findAllByStudent(studentId: string, userGymId?: string) {
    const gymId = this.requireGymId(userGymId);
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        gymId,
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
    const gymId = this.requireGymId(userGymId);
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

    if (!workout || workout.student.gymId !== gymId) {
      throw new NotFoundException('Treino nao encontrado');
    }

    return workout;
  }

  async updateStatus(id: string, status: string, userId: string, userGymId?: string) {
    const gymId = this.requireGymId(userGymId);
    const workout = await this.prisma.workout.findUnique({
      where: { id },
      include: { student: true },
    });

    if (!workout || workout.student.gymId !== gymId) {
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

    const updated = await this.prisma.workout.update({ where: { id }, data });

    await this.audit.record({
      gymId,
      userId,
      action: 'WORKOUT_STATUS_UPDATED',
      entity: 'Workout',
      entityId: id,
      previous: {
        status: workout.status,
        approvedById: workout.approvedById,
      },
      next: {
        status: updated.status,
        approvedById: updated.approvedById,
      },
    });

    return updated;
  }
}
