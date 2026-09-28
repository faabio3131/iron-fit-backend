import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertFiscalScopeBindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalTenantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalUnitId!: string;

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
