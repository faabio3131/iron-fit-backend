import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateAggregatorAgreementDto {
  @IsUUID()
  memberId!: string;

  @IsString()
  @Length(1, 64)
  version!: string;

  @Matches(/^[a-fA-F0-9]{64}$/)
  documentHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  documentRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  jurisdiction?: string;
}
