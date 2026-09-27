import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class IntegrationStepUpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  currentPassword!: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  mfaCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  recoveryCode?: string;
}

export class IntegrationSecretWriteDto extends IntegrationStepUpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32768)
  secretValue!: string;
}

export class CreateIntegrationAdminDto extends IntegrationSecretWriteDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/)
  providerCode!: string;

  @IsString()
  @IsIn([
    'API_KEY',
    'ACCESS_TOKEN',
    'OAUTH2',
    'BASIC',
    'CERTIFICATE',
    'WEBHOOK_SECRET',
    'CUSTOM',
  ])
  authModel!: 'API_KEY' | 'ACCESS_TOKEN' | 'OAUTH2' | 'BASIC' | 'CERTIFICATE' | 'WEBHOOK_SECRET' | 'CUSTOM';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9._:-]{1,127}$/, { each: true })
  capabilities!: string[];

  @IsOptional()
  @IsObject()
  publicConfiguration?: Record<string, unknown>;
}
