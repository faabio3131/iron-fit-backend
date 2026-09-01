import { IsString, IsOptional, IsUUID, IsInt, IsDateString } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  studentId: string;

  @IsString()
  planName: string;

  @IsInt()
  amount: number;

  @IsDateString()
  @IsOptional()
  nextBillingAt?: string;
}
