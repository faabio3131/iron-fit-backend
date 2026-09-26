import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSaasPriceDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  priceCode!: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  planCode!: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsIn(['MONTHLY', 'YEARLY'])
  interval!: 'MONTHLY' | 'YEARLY';
}

export class CreateSaasCheckoutDto {
  @IsUUID()
  requestId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  priceCode!: string;
}

export class ChangeSaasPlanDto extends CreateSaasCheckoutDto {
  @IsIn(['UPGRADE', 'DOWNGRADE'])
  transitionKind!: 'UPGRADE' | 'DOWNGRADE';

  @IsString()
  @MinLength(3)
  @MaxLength(256)
  reason!: string;
}

export class CancelSaasBillingDto {
  @IsBoolean()
  @IsOptional()
  atPeriodEnd?: boolean;
}

export class RefundSaasBillingDto {
  @IsUUID()
  requestId!: string;

  @IsUUID()
  invoiceId!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(256)
  reason!: string;
}

export class RunSaasBillingDto {
  @IsDateString()
  @IsOptional()
  asOf?: string;
}

export class BillingWebhookDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  eventId!: string;

  @IsIn(['checkout.completed', 'invoice.paid', 'invoice.payment_failed'])
  eventType!: 'checkout.completed' | 'invoice.paid' | 'invoice.payment_failed';

  @IsDateString()
  occurredAt!: string;

  @IsObject()
  data!: Record<string, unknown>;
}
