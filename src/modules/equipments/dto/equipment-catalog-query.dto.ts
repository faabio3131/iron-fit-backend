import { EquipmentCatalogCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class EquipmentCatalogQueryDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsEnum(EquipmentCatalogCategory)
  @IsOptional()
  category?: EquipmentCatalogCategory;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}
