import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AiWorkoutCandidateRequestDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  @IsOptional()
  assessmentId?: string;

  @IsUUID()
  @IsOptional()
  requestId?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  instructions?: string;
}
