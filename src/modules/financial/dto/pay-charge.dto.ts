import { IsString, IsOptional, IsUUID, IsInt, IsDateString } from 'class-validator';

export class PayChargeDto {
  @IsDateString()
  @IsOptional()
  paidAt?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsUUID()
  accountId: string;
}
