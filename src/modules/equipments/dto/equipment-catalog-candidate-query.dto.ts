import { Type } from 'class-transformer';
import { EquipmentCatalogCandidateStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class EquipmentCatalogCandidateQueryDto {
  @IsEnum(EquipmentCatalogCandidateStatus)
  @IsOptional()
  status?: EquipmentCatalogCandidateStatus;

  @IsUUID()
  @IsOptional()
  gymId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}
