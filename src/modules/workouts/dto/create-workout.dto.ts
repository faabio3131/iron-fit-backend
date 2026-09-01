import { IsString, IsOptional, IsUUID, IsInt, IsArray, IsDateString } from 'class-validator';

export class CreateWorkoutExerciseDto {
  @IsUUID()
  exerciseId: string;

  @IsUUID()
  @IsOptional()
  equipmentId?: string;

  @IsInt()
  @IsOptional()
  order?: number;

  @IsInt()
  @IsOptional()
  sets?: number;

  @IsString()
  @IsOptional()
  reps?: string;

  @IsInt()
  @IsOptional()
  restSeconds?: number;

  @IsString()
  @IsOptional()
  suggestedLoad?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateWorkoutSessionDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  sessionType?: string;

  @IsInt()
  @IsOptional()
  order?: number;

  @IsInt()
  @IsOptional()
  estimatedMinutes?: number;

  @IsArray()
  @IsOptional()
  exercises?: CreateWorkoutExerciseDto[];
}

export class CreateWorkoutDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  @IsOptional()
  assessmentId?: string;

  @IsString()
  @IsOptional()
  goal?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsInt()
  @IsOptional()
  weeklyFrequency?: number;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  sessions?: CreateWorkoutSessionDto[];
}
