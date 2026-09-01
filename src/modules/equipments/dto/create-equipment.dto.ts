import { IsString, IsOptional, IsObject, IsUUID } from 'class-validator';

export class CreateEquipmentDto {
  @IsUUID()
  @IsOptional()
  gymId?: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  standardName?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  primaryMuscle?: string;

  @IsObject()
  @IsOptional()
  secondaryMuscles?: any;

  @IsString()
  @IsOptional()
  movementPattern?: string;

  @IsString()
  @IsOptional()
  difficulty?: string;

  @IsObject()
  @IsOptional()
  contraindications?: any;

  @IsString()
  @IsOptional()
  videoUrl?: string;
}
