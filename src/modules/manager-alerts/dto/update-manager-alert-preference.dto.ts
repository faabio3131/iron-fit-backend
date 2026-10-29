import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateManagerAlertPreferenceDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @IsOptional()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  minimumSeverity?: 'INFO' | 'WARNING' | 'CRITICAL';

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursEnd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/)
  timezone?: string;
}
