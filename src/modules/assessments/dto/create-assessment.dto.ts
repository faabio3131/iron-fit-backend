import { IsString, IsOptional, IsUUID, IsNumber, IsObject, IsPositive, Min, Max } from 'class-validator';

export class CreateAssessmentDto {
  @IsUUID()
  @IsOptional()
  studentId?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  height?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  bmi?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  bodyFatPercent?: number;

  @IsObject()
  @IsOptional()
  measurements?: {
    chest?: number;
    waist?: number;
    hip?: number;
    rightArm?: number;
    leftArm?: number;
    rightThigh?: number;
    leftThigh?: number;
    rightCalf?: number;
    leftCalf?: number;
  };

  @IsObject()
  @IsOptional()
  restrictions?: {
    injuries?: string[];
    conditions?: string[];
    medications?: string[];
    notes?: string;
  };

  @IsString()
  @IsOptional()
  notes?: string;
}
