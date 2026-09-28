import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CancelFiscalHandoffDto {
  @IsString()
  @MinLength(15)
  @MaxLength(255)
  justification!: string;

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
