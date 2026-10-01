import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateMyCommunicationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  trainingReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  paymentReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  marketing?: boolean;
}
