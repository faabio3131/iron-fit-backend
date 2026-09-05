export type EquipmentExerciseCompatibility = 'PRIMARY' | 'ALTERNATIVE' | 'OPTIONAL';

export interface EquipmentExerciseMapping {
  exerciseId: string;
  exerciseName: string;
  compatibility: EquipmentExerciseCompatibility;
  priority: number;
  sourceVersion: string;
}

const COMPATIBILITIES = new Set<EquipmentExerciseCompatibility>([
  'PRIMARY',
  'ALTERNATIVE',
  'OPTIONAL',
]);

export function readEquipmentExerciseMappings(metadata: unknown): EquipmentExerciseMapping[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return [];
  }

  const raw = (metadata as { exerciseMappings?: unknown }).exerciseMappings;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    const compatibility = candidate.compatibility;
    if (
      typeof candidate.exerciseId !== 'string' ||
      typeof candidate.exerciseName !== 'string' ||
      typeof candidate.priority !== 'number' ||
      typeof candidate.sourceVersion !== 'string' ||
      typeof compatibility !== 'string' ||
      !COMPATIBILITIES.has(compatibility as EquipmentExerciseCompatibility)
    ) {
      return [];
    }

    return [{
      exerciseId: candidate.exerciseId,
      exerciseName: candidate.exerciseName,
      compatibility: compatibility as EquipmentExerciseCompatibility,
      priority: candidate.priority,
      sourceVersion: candidate.sourceVersion,
    }];
  });
}

export function findEquipmentExerciseMapping(
  metadata: unknown,
  exerciseId: string,
  exerciseName?: string,
) {
  return readEquipmentExerciseMappings(metadata).find(
    (mapping) =>
      mapping.exerciseId === exerciseId ||
      (exerciseName !== undefined && mapping.exerciseName === exerciseName),
  );
}
