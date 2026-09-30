import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExerciseContentPublishingService } from '../../creator-network/exercise-content-publishing.service';
import { AiSanitizerService } from '../security/ai-sanitizer.service';

export interface AiStudentContextRequest {
  gymId: string;
  userId: string;
  purpose: string;
  includeHealthData?: boolean;
}

export interface AiWorkoutGenerationContextRequest {
  gymId: string;
  studentId: string;
  assessmentId?: string;
  purpose: string;
  includeHealthData?: boolean;
}

export interface AiContentRecommendationContextRequest {
  gymId: string;
  userId: string;
  purpose: string;
  exerciseIds?: readonly string[];
}

@Injectable()
export class AiContextBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizer: AiSanitizerService,
    private readonly content: ExerciseContentPublishingService,
  ) {}

  async buildStudentAdvisoryContext(request: AiStudentContextRequest) {
    if (!request.gymId?.trim() || !request.userId?.trim()) {
      throw new ForbiddenException('Contexto AI exige tenant e usuario autenticados');
    }

    const student = await this.prisma.student.findFirst({
      where: {
        gymId: request.gymId,
        userId: request.userId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        goal: true,
        level: true,
        consentHealth: true,
        workouts: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            goal: true,
            level: true,
            weeklyFrequency: true,
            createdAt: true,
          },
        },
        assessments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            weight: true,
            height: true,
            bmi: true,
            bodyFatPercent: true,
            restrictions: true,
            createdAt: true,
          },
        },
      },
    });
    if (!student) throw new NotFoundException('Aluno ativo nao encontrado no tenant');

    const equipment = await this.prisma.equipment.findMany({
      where: { gymId: request.gymId, active: true },
      select: { id: true, name: true, catalogItemId: true },
      orderBy: { name: 'asc' },
      take: 250,
    });

    const latestAssessment = student.assessments[0];
    const health =
      request.includeHealthData === true && student.consentHealth && latestAssessment
        ? {
            assessmentId: latestAssessment.id,
            weight: latestAssessment.weight,
            height: latestAssessment.height,
            bmi: latestAssessment.bmi,
            bodyFatPercent: latestAssessment.bodyFatPercent,
            restrictions: latestAssessment.restrictions,
            assessedAt: latestAssessment.createdAt,
          }
        : undefined;

    return this.sanitizer.sanitize({
      purpose: request.purpose,
      student: {
        studentId: student.id,
        goal: student.goal,
        level: student.level,
      },
      workoutHistory: student.workouts.map((workout) => ({
        workoutId: workout.id,
        status: workout.status,
        goal: workout.goal,
        level: workout.level,
        weeklyFrequency: workout.weeklyFrequency,
        createdAt: workout.createdAt,
      })),
      equipment,
      health,
    });
  }

  async buildWorkoutGenerationContext(request: AiWorkoutGenerationContextRequest) {
    if (!request.gymId?.trim() || !request.studentId?.trim()) {
      throw new ForbiddenException('Geracao AI exige tenant e aluno alvo');
    }

    const student = await this.prisma.student.findFirst({
      where: {
        id: request.studentId,
        gymId: request.gymId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        goal: true,
        level: true,
        consentHealth: true,
        workouts: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            goal: true,
            level: true,
            weeklyFrequency: true,
            createdAt: true,
          },
        },
        assessments: {
          where: request.assessmentId ? { id: request.assessmentId } : undefined,
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            weight: true,
            height: true,
            bmi: true,
            bodyFatPercent: true,
            restrictions: true,
            createdAt: true,
          },
        },
      },
    });
    if (!student) throw new NotFoundException('Aluno ativo nao encontrado no tenant');
    if (request.assessmentId && student.assessments.length === 0) {
      throw new NotFoundException('Avaliacao nao encontrada para o aluno no tenant');
    }

    const equipment = await this.prisma.equipment.findMany({
      where: { gymId: request.gymId, active: true },
      select: { id: true, name: true, catalogItemId: true },
      orderBy: { name: 'asc' },
      take: 250,
    });

    const assessment = student.assessments[0];
    const health =
      request.includeHealthData === true && student.consentHealth && assessment
        ? {
            assessmentId: assessment.id,
            weight: assessment.weight,
            height: assessment.height,
            bmi: assessment.bmi,
            bodyFatPercent: assessment.bodyFatPercent,
            restrictions: assessment.restrictions,
            assessedAt: assessment.createdAt,
          }
        : undefined;

    return this.sanitizer.sanitize({
      purpose: request.purpose,
      student: {
        studentId: student.id,
        goal: student.goal,
        level: student.level,
      },
      workoutHistory: student.workouts.map((workout) => ({
        workoutId: workout.id,
        status: workout.status,
        goal: workout.goal,
        level: workout.level,
        weeklyFrequency: workout.weeklyFrequency,
        createdAt: workout.createdAt,
      })),
      equipment,
      health,
    });
  }


  async buildStudentContentRecommendationContext(
    request: AiContentRecommendationContextRequest,
  ) {
    if (!request.gymId?.trim() || !request.userId?.trim()) {
      throw new ForbiddenException(
        'Recomendacao de conteudo exige tenant e aluno autenticados',
      );
    }

    const student = await this.prisma.student.findFirst({
      where: {
        gymId: request.gymId,
        userId: request.userId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        workouts: {
          where: {
            status: { in: ['ACTIVE', 'APPROVED'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            sessions: {
              orderBy: { order: 'asc' },
              select: {
                exercises: {
                  orderBy: { order: 'asc' },
                  select: {
                    exercise: {
                      select: {
                        id: true,
                        name: true,
                        muscleGroup: true,
                        movement: true,
                        level: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!student) {
      throw new NotFoundException('Aluno ativo nao encontrado no tenant');
    }

    const canonicalExercises = new Map<
      string,
      {
        exerciseId: string;
        name: string;
        muscleGroup: string | null;
        movement: string | null;
        level: string | null;
      }
    >();
    for (const workout of student.workouts) {
      for (const session of workout.sessions) {
        for (const item of session.exercises) {
          canonicalExercises.set(item.exercise.id, {
            exerciseId: item.exercise.id,
            name: item.exercise.name,
            muscleGroup: item.exercise.muscleGroup,
            movement: item.exercise.movement,
            level: item.exercise.level,
          });
        }
      }
    }

    const requestedIds = request.exerciseIds?.length
      ? [...new Set(request.exerciseIds)]
      : null;
    if (requestedIds) {
      for (const exerciseId of requestedIds) {
        if (!canonicalExercises.has(exerciseId)) {
          throw new ForbiddenException(
            'Exercicio solicitado nao pertence ao treino ativo/aprovado do aluno',
          );
        }
      }
    }

    const selected = requestedIds
      ? requestedIds.map((exerciseId) => canonicalExercises.get(exerciseId)!)
      : [...canonicalExercises.values()];

    const eligibleExercises: Array<{
      exerciseId: string;
      name: string;
      muscleGroup: string | null;
      movement: string | null;
      level: string | null;
      contentKind: string;
      policyMode: string | null;
    }> = [];

    for (const exercise of selected.slice(0, 40)) {
      const resolved = await this.resolveEligibleExerciseContent(
        request.gymId,
        exercise.exerciseId,
        request.userId,
        true,
      );
      if (resolved.kind === 'NONE') continue;
      eligibleExercises.push({
        ...exercise,
        contentKind: resolved.kind,
        policyMode: resolved.policyMode,
      });
    }

    return {
      modelContext: this.sanitizer.sanitize({
        purpose: request.purpose,
        studentId: student.id,
        workoutIds: student.workouts.map((workout) => workout.id),
        eligibleExercises,
      }),
      eligibleExercises,
    };
  }

  async resolveEligibleExerciseContent(
    gymId: string,
    exerciseId: string,
    userId: string,
    isStudent = true,
  ) {
    if (!gymId?.trim()) throw new ForbiddenException('Conteudo AI exige tenant ativo');
    return this.content.resolveExerciseContent(gymId, exerciseId, userId, isStudent);
  }
}
