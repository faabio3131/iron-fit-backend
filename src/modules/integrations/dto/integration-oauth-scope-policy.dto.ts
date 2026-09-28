import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IntegrationEnvironment } from '@prisma/client';
import { StepUpDto } from '../../auth/dto/identity-security.dto';

export class CreateOAuthScopePolicyDto extends StepUpDto {
  @IsString()
  @MaxLength(64)
  providerCode!: string;

  @IsEnum(IntegrationEnvironment)
  environment!: IntegrationEnvironment;

  @IsString()
  @MaxLength(128)
  capability!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  scopes!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}

export class ReviewOAuthScopePolicyDto extends StepUpDto {}
