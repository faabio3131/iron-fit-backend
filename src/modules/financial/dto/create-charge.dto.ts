import { IsString, IsOptional, IsUUID, IsInt, IsDateString } from 'class-validator';

export class CreateChargeDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  @IsOptional()
  subscriptionId?: string;

  @IsInt()
  amount: number;

  @IsDateString()
  dueDate: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;
}
