import {
  CreatorManagedRelationKind,
  CreatorMediaAssetKind,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const CANONICAL_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const LANGUAGE_CODE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export class CreateCanonicalContentDto {
  @IsString()
  @Matches(CANONICAL_KEY_PATTERN)
  canonicalKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsEnum(CreatorManagedRelationKind)
  relationKind!: CreatorManagedRelationKind;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsUUID()
  rightsGrantId!: string;
}

export class RegisterMediaAssetDto {
  @IsEnum(CreatorMediaAssetKind)
  kind!: CreatorMediaAssetKind;

  @Matches(SHA256_PATTERN)
  integritySha256!: string;

  @IsString()
  @Matches(MIME_TYPE_PATTERN)
  @MaxLength(150)
  mimeType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400_000)
  durationMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32768)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32768)
  height?: number;

  @IsOptional()
  @IsString()
  @Matches(LANGUAGE_CODE_PATTERN)
  @MaxLength(35)
  languageCode?: string;
}
