import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateManagerAlertPolicyDto {
  @IsOptional()
  @IsBoolean()
  emailAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  pushAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappAllowed?: boolean;

  @IsOptional()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  minimumSeverity?: 'INFO' | 'WARNING' | 'CRITICAL';

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  criticalEscalationMin?: number;
}
