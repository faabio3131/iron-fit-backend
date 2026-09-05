import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { AggregatorSettlementStatus } from '@prisma/client';

export class RecordAggregatorSettlementDto {
  @IsUUID()
  connectionId!: string;

  @IsString()
  @Length(1, 128)
  externalSettlementId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  externalVisitId?: string;

  @IsEnum(AggregatorSettlementStatus)
  status!: AggregatorSettlementStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountExpected?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountConfirmed?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  providerStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  evidenceRef?: string;
}
