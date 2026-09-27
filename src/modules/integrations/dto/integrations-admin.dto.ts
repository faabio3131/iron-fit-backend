import {
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IntegrationEnvironment } from '@prisma/client';
import { StepUpDto } from '../../auth/dto/identity-security.dto';

export class CreateIntegrationConnectionDto extends StepUpDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/i)
  providerCode!: string;

  @IsEnum(IntegrationEnvironment)
  environment!: IntegrationEnvironment;

  @IsOptional()
  @IsObject()
  publicConfiguration?: Record<string, unknown>;
}

export class UpdateIntegrationConfigurationDto extends StepUpDto {
  @IsObject()
  publicConfiguration!: Record<string, unknown>;
}

export class PutIntegrationSecretDto extends StepUpDto {
  @IsObject()
  credentials!: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class VerifyIntegrationSecretDto extends StepUpDto {}
export class RevokeIntegrationSecretDto extends StepUpDto {}

export class IntegrationIdParamDto {
  @IsString()
  @MaxLength(64)
  id!: string;
}
