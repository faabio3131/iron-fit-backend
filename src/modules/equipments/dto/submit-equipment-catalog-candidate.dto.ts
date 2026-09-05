import { EquipmentCatalogCategory } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SubmitEquipmentCatalogCandidateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  proposedName: string;

  @IsEnum(EquipmentCatalogCategory)
  @IsOptional()
  proposedCategory?: EquipmentCatalogCategory;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  manufacturerName?: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  modelName?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @IsOptional()
  aliases?: string[];

  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  @IsOptional()
  evidenceUrl?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}
