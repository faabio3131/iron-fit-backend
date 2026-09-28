import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '@prisma/client';
import {
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
