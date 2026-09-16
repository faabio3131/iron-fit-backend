import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AiContextBuilderService } from './context/ai-context-builder.service';
import { AiChatDto, AiWorkoutInsightsDto } from './dto/ai-mobile-advisory.dto';
import { AiPolicyGuardService } from './policy/ai-policy-guard.service';
import { AiProviderExecutionService } from './runtime/ai-provider-execution.service';
import { AiSanitizerService } from './security/ai-sanitizer.service';
import { AiGovernedOutput, AiOutputValidatorService } from './validation/ai-output-validator.service';

interface AuthenticatedStudentIdentity {
  id: string;
  activeGymId?: string | null;
  gymId?: string | null;
}

interface WorkoutInsightOutput extends AiGovernedOutput {
  summary?: unknown;
  insight?: unknown;
  message?: unknown;
  recommendations?: unknown;
  projection?: unknown;
}

interface ChatOutput extends AiGovernedOutput {
  message?: unknown;
  reply?: unknown;
  answer?: unknown;
}

@Injectable()
export class AiMobileAdvisoryService {
  constructor(
    private readonly policy: AiPolicyGuardService,
    private readonly contextBuilder: AiContextBuilderService,
    private readonly sanitizer: AiSanitizerService,
    private readonly execution: AiProviderExecutionService,
    private readonly outputValidator: AiOutputValidatorService,
  ) {}

  async workoutInsights(user: AuthenticatedStudentIdentity, dto: AiWorkoutInsightsDto) {
    const identity = this.resolveIdentity(user);
    const purpose = 'student_workout_insights';

    await this.policy.assertAllowed({
      gymId: identity.gymId,
      userId: identity.userId,
      capability: 'WORKOUT_INSIGHTS',
      purpose,
      isStudent: true,
    });

    const canonicalContext = await this.contextBuilder.buildStudentAdvisoryContext({
      gymId: identity.gymId,
      userId: identity.userId,
      purpose,
      includeHealthData: false,
    });

    const response = await this.execution.execute<unknown, WorkoutInsightOutput>({
      capability: 'WORKOUT_INSIGHTS',
      prompt: { promptKey: 'student.workout_insights', promptVersion: 1 },
      context: {
        tenantId: identity.gymId,
        actorId: identity.userId,
        purpose,
        requestId: randomUUID(),
      },
      input: this.sanitizer.sanitize({
        kind: dto.kind ?? 'workout_insights',
        context: canonicalContext,
      }),
    });

    const output = await this.requireValidatedOutput(
      identity.gymId,
      identity.userId,
      response,
    );
    return this.normalizeWorkoutInsight(output as WorkoutInsightOutput);
  }

  async chat(user: AuthenticatedStudentIdentity, dto: AiChatDto) {
    const identity = this.resolveIdentity(user);
    const purpose = 'student_advisory_chat';

    await this.policy.assertAllowed({
      gymId: identity.gymId,
      userId: identity.userId,
      capability: 'ADVISORY_CHAT',
      purpose,
      isStudent: true,
    });

    const canonicalContext = await this.contextBuilder.buildStudentAdvisoryContext({
      gymId: identity.gymId,
      userId: identity.userId,
      purpose,
      includeHealthData: false,
    });

    const response = await this.execution.execute<unknown, ChatOutput>({
      capability: 'ADVISORY_CHAT',
      prompt: { promptKey: 'student.advisory_chat', promptVersion: 1 },
      context: {
        tenantId: identity.gymId,
        actorId: identity.userId,
        purpose,
        requestId: randomUUID(),
      },
      input: this.sanitizer.sanitize({
        message: dto.message,
        context: canonicalContext,
      }),
    });

    const output = await this.requireValidatedOutput(
      identity.gymId,
      identity.userId,
      response,
    );
    return { message: this.requireText((output as ChatOutput).message ?? (output as ChatOutput).reply ?? (output as ChatOutput).answer) };
  }

  private resolveIdentity(user: AuthenticatedStudentIdentity) {
    const userId = user?.id?.trim();
    const gymId = (user?.activeGymId ?? user?.gymId)?.trim();
    if (!userId || !gymId) {
      throw new ForbiddenException('AI advisory exige aluno e tenant autenticados');
    }
    return { userId, gymId };
  }

  private async requireValidatedOutput(
    gymId: string,
    userId: string,
    response: {
      status: string;
      output?: AiGovernedOutput;
      flags: readonly string[];
      failureCategory?: string;
    },
  ): Promise<AiGovernedOutput> {
    if (response.status !== 'SUCCEEDED' || !response.output) {
      throw new ServiceUnavailableException({
        code: 'AI_ADVISORY_UNAVAILABLE',
        failureCategory: response.failureCategory ?? 'UNAVAILABLE',
        flags: response.flags,
      });
    }

    const validation = await this.outputValidator.validateAdvisoryOutput(
      gymId,
      userId,
      response.output,
      true,
    );
    if (!validation.valid || !validation.output) {
      throw new BadGatewayException({
        code: 'AI_ADVISORY_INVALID_RESPONSE',
        failureCategory: validation.failureCategory ?? 'INVALID_RESPONSE',
        flags: validation.flags,
      });
    }
    return validation.output;
  }

  private normalizeWorkoutInsight(output: WorkoutInsightOutput) {
    const summary = this.requireText(output.summary ?? output.insight ?? output.message);
    const recommendations = Array.isArray(output.recommendations)
      ? output.recommendations.slice(0, 3).map((item, index) => this.normalizeRecommendation(item, index))
      : [];
    const projection = this.normalizeProjection(output.projection);

    return {
      summary,
      recommendations,
      projection,
    };
  }

  private normalizeRecommendation(value: unknown, index: number) {
    if (typeof value === 'string') {
      return { title: `Recomendacao ${index + 1}`, detail: this.requireText(value) };
    }
    if (!value || typeof value !== 'object') {
      throw new BadGatewayException('Resposta AI contem recomendacao invalida');
    }
    const record = value as Record<string, unknown>;
    return {
      title: this.requireText(record.title ?? record.label ?? `Recomendacao ${index + 1}`),
      detail: this.requireText(record.detail ?? record.description ?? record.text),
    };
  }

  private normalizeProjection(value: unknown) {
    if (!value || typeof value !== 'object') {
      throw new BadGatewayException('Resposta AI contem projecao invalida');
    }
    const record = value as Record<string, unknown>;
    return {
      label: this.requireText(record.label),
      value: this.requireText(record.value),
      detail: this.requireText(record.detail ?? record.description),
    };
  }

  private requireText(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadGatewayException('Resposta AI contem texto invalido');
    }
    return value.trim().slice(0, 2000);
  }
}
