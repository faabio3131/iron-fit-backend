import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '@prisma/client';

export class CreateDataSubjectRequestDto {
  @IsUUID()
  requestId!: string;

  @IsEnum(DataSubjectRequestType)
  requestType!: DataSubjectRequestType;
}

export class UpdateDataSubjectRequestDto {
  @IsEnum(DataSubjectRequestStatus)
  status!: DataSubjectRequestStatus;

  @IsOptional()
  @IsBoolean()
  identityVerified?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  resolutionCode?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  currentPassword!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  mfaCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  recoveryCode?: string;
}
