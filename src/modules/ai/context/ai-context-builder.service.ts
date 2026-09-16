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
