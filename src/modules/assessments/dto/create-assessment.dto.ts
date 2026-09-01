import { IsString, IsOptional, IsUUID, IsNumber, IsObject } from 'class-validator';

export class CreateAssessmentDto {
  @IsUUID()
  @IsOptional()
  studentId?: string;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  height?: number;

  @IsNumber()
  @IsOptional()
  bmi?: number;

  @IsNumber()
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
