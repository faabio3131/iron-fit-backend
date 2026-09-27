import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StepUpDto } from '../../auth/dto/identity-security.dto';

export const BREAK_GLASS_OPERATIONS = ['PROVIDER_VERIFY'] as const;
export type BreakGlassOperationDto =
  (typeof BREAK_GLASS_OPERATIONS)[number];

export class IntegrationBreakGlassRequestDto extends StepUpDto {
  @IsUUID()
  connectionId!: string;

  @IsString()
  @IsIn(BREAK_GLASS_OPERATIONS)
  operation!: BreakGlassOperationDto;

  @IsString()
  @MinLength(20)
  @MaxLength(500)
  reason!: string;

  @IsInt()
  @Min(60)
  @Max(900)
  ttlSeconds!: number;
}

export class IntegrationBreakGlassApproveDto extends StepUpDto {
  @IsString()
  @IsIn(['APPROVE_BREAK_GLASS'])
  confirmation!: 'APPROVE_BREAK_GLASS';
}

export class IntegrationBreakGlassExecuteDto extends StepUpDto {
  @IsString()
  @IsIn(['EXECUTE_BREAK_GLASS'])
  confirmation!: 'EXECUTE_BREAK_GLASS';
}

export class IntegrationBreakGlassRevokeDto extends StepUpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  reason!: string;
}
