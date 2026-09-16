import { Injectable } from '@nestjs/common';
import { EquipmentsService } from '../../equipments/equipments.service';
import { ExerciseContentPublishingService } from '../../creator-network/exercise-content-publishing.service';
import { AiValidationResult } from '../contracts/ai-contract';

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'approved',
  'approvedById',
  'active',
  'status',
  'payment',
  'charge',
  'financial',
  'fiscal',
  'accessAuthorization',
  'entitlement',
  'rightsGrant',
  'publish',
]);
const URL_PATTERN = /https?:\/\/[^\s]+/i;

export interface AiExerciseEquipmentReference {
  exerciseId: string;
  equipmentId: string;
}

export interface AiContentReference {
  exerciseId: string;
  contentId: string;
}

export interface AiGovernedOutput {
  exerciseEquipment?: readonly AiExerciseEquipmentReference[];
  contentRecommendations?: readonly AiContentReference[];
  [key: string]: unknown;
}

@Injectable()
export class AiOutputValidatorService {
  constructor(
    private readonly equipments: EquipmentsService,
    private readonly content: ExerciseContentPublishingService,
  ) {}

  async validateAdvisoryOutput(
    gymId: string,
    userId: string,
    output: AiGovernedOutput,
    isStudent = true,
  ): Promise<AiValidationResult<AiGovernedOutput>> {
    const flags: string[] = [];
    if (!gymId?.trim() || !userId?.trim() || !output || typeof output !== 'object') {
      return { valid: false, flags: ['INVALID_CONTEXT'], failureCategory: 'POLICY_DENIED' };
    }
    if (this.containsForbiddenAuthority(output)) {
      return { valid: false, flags: ['AUTHORITY_MUTATION_REJECTED'], failureCategory: 'POLICY_DENIED' };
    }
    if (this.containsUrl(output)) {
      return { valid: false, flags: ['MODEL_URL_REJECTED'], failureCategory: 'INVALID_RESPONSE' };
    }

    for (const reference of output.exerciseEquipment ?? []) {
      if (!reference?.exerciseId || !reference?.equipmentId) {
        return { valid: false, flags: ['MALFORMED_EQUIPMENT_REFERENCE'], failureCategory: 'INVALID_RESPONSE' };
      }
      const compatible = await this.equipments.findCompatibleForExercise(
        reference.exerciseId,
        gymId,
      );
      if (!compatible.some((item) => item.id === reference.equipmentId)) {
        return { valid: false, flags: ['EQUIPMENT_NOT_ELIGIBLE'], failureCategory: 'INVALID_RESPONSE' };
      }
      flags.push('EQUIPMENT_CANONICAL');
    }

    for (const reference of output.contentRecommendations ?? []) {
      if (!reference?.exerciseId || !reference?.contentId) {
        return { valid: false, flags: ['MALFORMED_CONTENT_REFERENCE'], failureCategory: 'INVALID_RESPONSE' };
      }
      const resolved = await this.content.resolveExerciseContent(
        gymId,
        reference.exerciseId,
        userId,
        isStudent,
      );
      if (resolved.kind !== 'MANAGED_CONTENT' || resolved.contentId !== reference.contentId) {
        return { valid: false, flags: ['CONTENT_NOT_ELIGIBLE'], failureCategory: 'INVALID_RESPONSE' };
      }
      flags.push('CONTENT_CANONICAL');
    }

    return { valid: true, output, flags };
  }

  private containsForbiddenAuthority(value: unknown): boolean {
    if (Array.isArray(value)) return value.some((item) => this.containsForbiddenAuthority(item));
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) => FORBIDDEN_AUTHORITY_KEYS.has(key) || this.containsForbiddenAuthority(nested),
    );
  }

  private containsUrl(value: unknown): boolean {
    if (typeof value === 'string') return URL_PATTERN.test(value);
    if (Array.isArray(value)) return value.some((item) => this.containsUrl(item));
    if (!value || typeof value !== 'object') return false;
    return Object.values(value as Record<string, unknown>).some((nested) => this.containsUrl(nested));
  }
}
