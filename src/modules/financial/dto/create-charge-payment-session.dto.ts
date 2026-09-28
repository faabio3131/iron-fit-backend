import { IsUUID } from 'class-validator';

export class CreateChargePaymentSessionDto {
  @IsUUID()
  requestId!: string;
}
