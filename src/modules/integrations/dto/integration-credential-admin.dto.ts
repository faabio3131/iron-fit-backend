import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StepUpDto } from '../../auth/dto/identity-security.dto';
import {
  INTEGRATION_AUTH_MODELS,
  INTEGRATION_ENVIRONMENTS,
} from '../contracts/integration-contract';

export class CreateIntegrationCredentialDto extends StepUpDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  providerCode!: string;

  @IsString()
  @IsIn(INTEGRATION_ENVIRONMENTS)
  environment!: (typeof INTEGRATION_ENVIRONMENTS)[number];

  @IsString()
  @IsIn(INTEGRATION_AUTH_MODELS)
  authModel!: (typeof INTEGRATION_AUTH_MODELS)[number];

  @IsArray()
  @IsString({ each: true })
  capabilities!: string[];

  @IsOptional()
  @IsObject()
  publicConfiguration?: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  @MaxLength(25600)
  secret!: string;
}

export class RotateIntegrationCredentialDto extends StepUpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(25600)
  secret!: string;
}

export class VerifyIntegrationCredentialDto extends StepUpDto {}

export class RevokeIntegrationCredentialDto extends StepUpDto {}
