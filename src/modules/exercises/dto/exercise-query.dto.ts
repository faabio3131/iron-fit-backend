import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ExerciseQueryDto {
  @IsString()
  @MaxLength(120)
  @IsOptional()
  search?: string;

  @IsString()
  @MaxLength(80)
  @IsOptional()
  muscleGroup?: string;

  @IsString()
  @MaxLength(80)
  @IsOptional()
  movement?: string;

  @IsString()
  @MaxLength(80)
  @IsOptional()
  level?: string;
}
