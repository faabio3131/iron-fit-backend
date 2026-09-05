import {
  CreatorManagedRelationKind,
  CreatorRightsBasisKind,
  CreatorRightsConsentKind,
  CreatorRightsHolderKind,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

export class CreateRightsHolderDto {
  @IsEnum(CreatorRightsHolderKind)
  kind!: CreatorRightsHolderKind;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  externalReference?: string;
}

class RightsGrantTermsDto {
  @IsUUID()
  rightsHolderId!: string;

  @IsEnum(CreatorRightsBasisKind)
  basisKind!: CreatorRightsBasisKind;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  usageScopes!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  deliveryScopes!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  territories!: string[];

  @IsISO8601({ strict: true })
  validFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  validUntil?: string;

  @IsBoolean()
  attributionRequired!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attributionText?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  evidenceReference!: string;

  @Matches(SHA256_PATTERN)
  evidenceSha256!: string;

  @IsOptional()
  @Matches(SHA256_PATTERN)
  termsSha256?: string;

  @IsBoolean()
  requiresCreatorConsent!: boolean;
}

export class CreateRightsGrantDto extends RightsGrantTermsDto {
  @IsEnum(CreatorManagedRelationKind)
  relationKind!: CreatorManagedRelationKind;
}

export class CreateRightsGrantVersionDto extends RightsGrantTermsDto {}

export class CreateRightsConsentDto {
  @IsUUID()
  creatorId!: string;

  @IsEnum(CreatorRightsConsentKind)
  kind!: CreatorRightsConsentKind;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  purposeScopes!: string[];

  @IsISO8601({ strict: true })
  validFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  validUntil?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  evidenceReference!: string;

  @Matches(SHA256_PATTERN)
  evidenceSha256!: string;
}

export class RightsReasonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
