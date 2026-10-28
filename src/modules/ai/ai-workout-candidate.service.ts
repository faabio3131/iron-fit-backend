import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkoutDto } from '../workouts/dto/create-workout.dto';
import { WorkoutsService } from '../workouts/workouts.service';
import { AiConfigurationResolverService } from './configuration/ai-configuration-resolver.service';
import { AiContextBuilderService } from './context/ai-context-builder.service';
import { AiWorkoutCandidateRequestDto } from './dto/ai-workout-candidate.dto';
import { AiPersistenceService } from './ai-persistence.service';
import { AiPolicyGuardService } from './policy/ai-policy-guard.service';
import { AiProviderExecutionService } from './runtime/ai-provider-execution.service';
import { AiSanitizerService } from './security/ai-sanitizer.service';
import { AiGovernedOutput, AiOutputValidatorService } from './validation/ai-output-validator.service';

interface AuthenticatedProfessionalIdentity {
  id: string;
  activeGymId?: string | null;
  gymId?: string | null;
}

interface WorkoutCandidateOutput extends AiGovernedOutput {
  goal?: unknown;
  level?: unknown;
  weeklyFrequency?: unknown;
  startDate?: unknown;
  validUntil?: unknown;
  notes?: unknown;
  sessions?: unknown;
}

@Injectable()
export class AiWorkoutCandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyGuardService,
    private readonly contextBuilder: AiContextBuilderService,
    private readonly sanitizer: AiSanitizerService,
    private readonly execution: AiProviderExecutionService,
    private readonly configurations: AiConfigurationResolverService,
    private readonly persistence: AiPersistenceService,
    private readonly outputValidator: AiOutputValidatorService,
    private readonly workouts: WorkoutsService,
  ) {}

  async generate(user: AuthenticatedProfessionalIdentity, gymId: string, dto: AiWorkoutCandidateRequestDto) {
    const actorId = user?.id?.trim();
    if (!actorId || !gymId?.trim()) {
      throw new ForbiddenException('AI workout candidate exige usuario e tenant autenticados');
    }

    const purpose = 'workout_candidate_generation';
    const requestId = dto.requestId ?? randomUUID();

    await this.policy.assertAllowed({
      gymId,
      userId: actorId,
      capability: 'WORKOUT_GENERATION',
      purpose,
      isStudent: false,
    });

    const context = await this.contextBuilder.buildWorkoutGenerationContext({
      gymId,
      studentId: dto.studentId,
      assessmentId: dto.assessmentId,
      purpose,
      includeHealthData: true,
    });

    const input = this.sanitizer.sanitize({
      instructions: dto.instructions,
      context,
    });
    const startedAt = Date.now();
    const resolution = await this.configurations.resolve(gymId, 'WORKOUT_GENERATION');
    const response = await this.execution.execute<unknown, WorkoutCandidateOutput>({
      capability: 'WORKOUT_GENERATION',
      prompt: { promptKey: 'workout.candidate_generation', promptVersion: 1 },
      context: {
        tenantId: gymId,
        actorId,
        studentId: dto.studentId,
        purpose,
        requestId,
      },
      input,
    });
    const latencyMs = Date.now() - startedAt;

    if (!resolution.available || !resolution.configuration) {
      throw new ServiceUnavailableException({
        code: 'AI_WORKOUT_GENERATION_UNAVAILABLE',
        failureCategory: 'CONFIGURATION_UNAVAILABLE',
        flags: resolution.flags,
      });
    }

    if (response.status !== 'SUCCEEDED' || !response.output) {
      await this.persistence.recordExecution({
        tenantId: gymId,
        actorId,
        studentId: dto.studentId,
        capability: 'WORKOUT_GENERATION',
        providerCode: response.execution?.providerCode ?? resolution.configuration.providerCode,
        modelCode: response.execution?.modelCode ?? resolution.configuration.modelCode,
        promptKey: 'workout.candidate_generation',
        promptVersion: 1,
        configurationProfileId: response.execution?.profileId ?? resolution.profileId,
        configurationScope: response.execution?.scope ?? resolution.configuration.scope,
        configurationVersion: response.execution?.version ?? resolution.configuration.version,
        inputHash: this.hash(input),
        flags: response.flags,
        status: response.status,
        failureCategory: response.failureCategory,
        latencyMs,
        requestId,
      });
      throw new ServiceUnavailableException({
        code: 'AI_WORKOUT_GENERATION_UNAVAILABLE',
        failureCategory: response.failureCategory ?? 'UNAVAILABLE',
        flags: response.flags,
      });
    }

    const validation = await this.outputValidator.validateAdvisoryOutput(
      gymId,
      actorId,
      response.output,
      false,
    );
    if (!validation.valid || !validation.output) {
      await this.persistence.recordExecution({
        tenantId: gymId,
        actorId,
        studentId: dto.studentId,
        capability: 'WORKOUT_GENERATION',
        providerCode: response.execution?.providerCode ?? resolution.configuration.providerCode,
        modelCode: response.execution?.modelCode ?? resolution.configuration.modelCode,
        promptKey: 'workout.candidate_generation',
        promptVersion: 1,
        configurationProfileId: response.execution?.profileId ?? resolution.profileId,
        configurationScope: response.execution?.scope ?? resolution.configuration.scope,
        configurationVersion: response.execution?.version ?? resolution.configuration.version,
        inputHash: this.hash(input),
        outputHash: this.hash(response.output),
        confidence: response.confidence,
        flags: [...response.flags, ...validation.flags],
        status: 'REJECTED',
        failureCategory: validation.failureCategory ?? 'INVALID_RESPONSE',
        latencyMs,
        requestId,
      });
      throw new BadGatewayException({
        code: 'AI_WORKOUT_GENERATION_INVALID_RESPONSE',
        failureCategory: validation.failureCategory ?? 'INVALID_RESPONSE',
        flags: validation.flags,
      });
    }

    // Validate the structured domain candidate before recording a successful AI trace.
    // A model response can pass advisory checks but still contain unusable sessions.
    let workoutDto: CreateWorkoutDto;
    try {
      workoutDto = this.normalizeCandidate(dto, validation.output as WorkoutCandidateOutput);
    } catch (error) {
      if (!(error instanceof BadGatewayException)) throw error;
      await this.persistence.recordExecution({
        tenantId: gymId,
        actorId,
        studentId: dto.studentId,
        capability: 'WORKOUT_GENERATION',
        providerCode: response.execution?.providerCode ?? resolution.configuration.providerCode,
        modelCode: response.execution?.modelCode ?? resolution.configuration.modelCode,
        promptKey: 'workout.candidate_generation',
        promptVersion: 1,
        configurationProfileId: response.execution?.profileId ?? resolution.profileId,
        configurationScope: response.execution?.scope ?? resolution.configuration.scope,
        configurationVersion: response.execution?.version ?? resolution.configuration.version,
        inputHash: this.hash(input),
        outputHash: this.hash(response.output),
        confidence: response.confidence,
        flags: [...response.flags, ...validation.flags],
        status: 'REJECTED',
        failureCategory: 'INVALID_RESPONSE',
        latencyMs,
        requestId,
      });
      throw new BadGatewayException({
        code: 'AI_WORKOUT_GENERATION_INVALID_RESPONSE',
        failureCategory: 'INVALID_RESPONSE',
        flags: validation.flags,
      });
    }

    const trace = await this.persistence.recordExecution({
      tenantId: gymId,
      actorId,
      studentId: dto.studentId,
      capability: 'WORKOUT_GENERATION',
      providerCode: response.execution?.providerCode ?? resolution.configuration.providerCode,
      modelCode: response.execution?.modelCode ?? resolution.configuration.modelCode,
      promptKey: 'workout.candidate_generation',
      promptVersion: 1,
      configurationProfileId: response.execution?.profileId ?? resolution.profileId,
      configurationScope: response.execution?.scope ?? resolution.configuration.scope,
      configurationVersion: response.execution?.version ?? resolution.configuration.version,
      inputHash: this.hash(input),
      outputHash: this.hash(response.output),
      confidence: response.confidence,
      flags: [...response.flags, ...validation.flags],
      status: 'SUCCEEDED',
      latencyMs,
      requestId,
    });

    const workout = await this.workouts.createAiCandidate(
      workoutDto,
      gymId,
      actorId,
      requestId,
    );

    await this.prisma.auditLog.create({
      data: {
        gymId,
        userId: actorId,
        action: 'AI_WORKOUT_CANDIDATE_LINKED',
        entity: 'Workout',
        entityId: workout.id,
        next: {
          workoutId: workout.id,
          status: workout.status,
          createdByAI: workout.createdByAI,
          aiExecutionTraceId: trace.id,
          requestId,
        },
      },
    });

    return {
      workout,
      provenance: {
        executionTraceId: trace.id,
        requestId,
      },
      requiresHumanReview: true,
    };
  }

  private normalizeCandidate(
    request: AiWorkoutCandidateRequestDto,
    output: WorkoutCandidateOutput,
  ): CreateWorkoutDto {
    if (!Array.isArray(output.sessions) || output.sessions.length === 0 || output.sessions.length > 14) {
      throw new BadGatewayException('Resposta AI deve conter entre 1 e 14 sessoes');
    }

    return {
      studentId: request.studentId,
      assessmentId: request.assessmentId,
      goal: this.optionalText(output.goal, 250),
      level: this.optionalText(output.level, 120),
      weeklyFrequency: this.optionalInteger(output.weeklyFrequency, 1, 14),
      startDate: this.optionalDate(output.startDate),
      validUntil: this.optionalDate(output.validUntil),
      notes: this.optionalText(output.notes, 2000),
      sessions: output.sessions.map((session, sessionIndex) => {
        const row = this.record(session, 'sessao');
        const exercises = Array.isArray(row.exercises) ? row.exercises : [];
        if (exercises.length === 0 || exercises.length > 40) {
          throw new BadGatewayException('Sessao AI deve conter entre 1 e 40 exercicios');
        }
        return {
          name: this.requiredText(row.name, 160),
          sessionType: this.optionalText(row.sessionType, 120),
          order: this.optionalInteger(row.order, 1, 100) ?? sessionIndex + 1,
          estimatedMinutes: this.optionalInteger(row.estimatedMinutes, 1, 600),
          exercises: exercises.map((exercise, exerciseIndex) => {
            const item = this.record(exercise, 'exercicio');
            return {
              exerciseId: this.requiredUuid(item.exerciseId),
              equipmentId: item.equipmentId === undefined || item.equipmentId === null
                ? undefined
                : this.requiredUuid(item.equipmentId),
              order: this.optionalInteger(item.order, 1, 1000) ?? exerciseIndex + 1,
              sets: this.optionalInteger(item.sets, 1, 100),
              reps: this.optionalText(item.reps, 80),
              restSeconds: this.optionalInteger(item.restSeconds, 0, 3600),
              suggestedLoad: this.optionalText(item.suggestedLoad, 120),
              notes: this.optionalText(item.notes, 1000),
            };
          }),
        };
      }),
    };
  }

  private record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadGatewayException(`Resposta AI contem ${label} invalido`);
    }
    return value as Record<string, unknown>;
  }

  private requiredText(value: unknown, max: number) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadGatewayException('Resposta AI contem texto obrigatorio invalido');
    }
    return value.trim().slice(0, max);
  }

  private optionalText(value: unknown, max: number): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return this.requiredText(value, max);
  }

  private optionalInteger(value: unknown, min: number, max: number): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw new BadGatewayException('Resposta AI contem inteiro fora do intervalo permitido');
    }
    return value as number;
  }

  private optionalDate(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const text = this.requiredText(value, 64);
    if (Number.isNaN(Date.parse(text))) {
      throw new BadGatewayException('Resposta AI contem data invalida');
    }
    return text;
  }

  private requiredUuid(value: unknown): string {
    const text = this.requiredText(value, 64);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
      throw new BadGatewayException('Resposta AI contem UUID invalido');
    }
    return text;
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
  }
}
