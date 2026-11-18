import { IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, Equals } from 'class-validator';

export class AlignFmLegacyLimitDto {
  @IsUUID()
  configurationId: string;

  @IsUUID()
  subscriptionId: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  planCode: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  planVersion: number;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  legacyLimit: number;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  planLimit: number;

  @Equals('ALINHAR_AO_LIMITE_DO_PLANO')
  confirm: string;

  @IsString()
  @MinLength(10)
  @MaxLength(300)
  reason: string;
}
