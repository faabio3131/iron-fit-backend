export declare class CreateWorkoutExerciseDto {
    exerciseId: string;
    equipmentId?: string;
    order?: number;
    sets?: number;
    reps?: string;
    restSeconds?: number;
    suggestedLoad?: string;
    notes?: string;
}
export declare class CreateWorkoutSessionDto {
    name: string;
    sessionType?: string;
    order?: number;
    estimatedMinutes?: number;
    exercises?: CreateWorkoutExerciseDto[];
}
export declare class CreateWorkoutDto {
    studentId: string;
    assessmentId?: string;
    goal?: string;
    level?: string;
    weeklyFrequency?: number;
    startDate?: string;
    validUntil?: string;
    notes?: string;
    sessions?: CreateWorkoutSessionDto[];
}
