import { IsBoolean, IsUUID } from 'class-validator';

export class ConfigurePaymentAutomationDto {
  @IsUUID()
  accountId!: string;

  @IsBoolean()
  enabled!: boolean;
}
