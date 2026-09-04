import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateConsentsDto {
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
