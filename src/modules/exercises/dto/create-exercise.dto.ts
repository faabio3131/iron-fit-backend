import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateExerciseDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  muscleGroup?: string;

  @IsString()
  @IsOptional()
  movement?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsObject()
  @IsOptional()
  contraindications?: any;
}
