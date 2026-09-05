import { EquipmentCatalogCategory } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum EquipmentCatalogCandidateDecision {
  APPROVE = 'APPROVE',
  MERGE = 'MERGE',
  REJECT = 'REJECT',
}

export class ReviewEquipmentCatalogCandidateDto {
  @IsEnum(EquipmentCatalogCandidateDecision)
  decision: EquipmentCatalogCandidateDecision;

  @IsUUID()
  @IsOptional()
  catalogItemId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @IsOptional()
  canonicalName?: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  @MaxLength(180)
  @IsOptional()
  canonicalSlug?: string;

  @IsEnum(EquipmentCatalogCategory)
  @IsOptional()
  canonicalCategory?: EquipmentCatalogCategory;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  reviewNotes?: string;
}
