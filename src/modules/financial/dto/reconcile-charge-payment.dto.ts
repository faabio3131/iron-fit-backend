import { IsUUID } from 'class-validator';

export class ReconcileChargePaymentDto {
  @IsUUID()
  accountId!: string;
}
