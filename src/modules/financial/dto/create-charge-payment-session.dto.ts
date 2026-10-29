import { IsOptional, IsUUID } from 'class-validator';

export class CreateChargePaymentSessionDto {
  @IsUUID()
  requestId!: string;

  // Explicit tenant-owned integration selection. No cross-tenant or global fallback.
  @IsOptional()
  @IsUUID()
  providerConnectionId?: string;
}
