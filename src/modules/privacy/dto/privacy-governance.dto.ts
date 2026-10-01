import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateDataSubjectRequestDto {
  @IsEnum(DataSubjectRequestType)
  type!: DataSubjectRequestType;
}

export class CancelDataSubjectRequestDto {
  @IsUUID()
  requestId!: string;
}

export class AcceptLegalDocumentDto {
  @IsUUID()
  legalDocumentId!: string;
}

export class ReviewDataSubjectRequestDto {
  @IsEnum(DataSubjectRequestStatus)
  status!: DataSubjectRequestStatus;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  resolutionCode?: string;
}


export class UpdateMyPrivacyConsentsDto {
  @IsOptional()
  @IsBoolean()
  consentHealth?: boolean;

  @IsOptional()
  @IsBoolean()
  consentComm?: boolean;

  @IsOptional()
  @IsBoolean()
  consentBiometry?: boolean;
}
