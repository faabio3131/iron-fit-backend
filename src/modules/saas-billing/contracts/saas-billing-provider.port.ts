import { createHash } from 'node:crypto';
import { IntegrationSecretValue } from '../../integrations/secrets/integration-secret-vault.port';

export interface SaasBillingProviderContext {
  connectionId: string | null;
  publicConfiguration: unknown;
  credential: IntegrationSecretValue | null;
}

export interface SaasCheckoutProviderInput {
  requestId: string;
  gymId: string;
  agreementId: string;
  priceCode: string;
  amountMinor: number;
  currency: string;
}

export interface SaasCheckoutProviderResult {
  providerSessionRef: string;
  checkoutUrl: string | null;
  expiresAt: Date;
}

export interface SaasRefundProviderInput {
  requestId: string;
  providerPaymentRef: string;
  amountMinor: number;
  currency: string;
  reason: string;
}

export interface SaasRefundProviderResult {
  providerRefundRef: string;
  status: 'PENDING' | 'SUCCEEDED';
}

export interface SaasBillingProviderPort {
  readonly code: string;
  assertAvailable(context?: SaasBillingProviderContext): void;
  createCheckout(
    input: SaasCheckoutProviderInput,
    context?: SaasBillingProviderContext,
  ): Promise<SaasCheckoutProviderResult>;
  requestRefund(
    input: SaasRefundProviderInput,
    context?: SaasBillingProviderContext,
  ): Promise<SaasRefundProviderResult>;
  verifyWebhook(
    payload: unknown,
    signature?: string,
    context?: SaasBillingProviderContext,
  ): void;
}

export function canonicalBillingPayload(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalBillingPayload(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalBillingPayload(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function billingPayloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalBillingPayload(value)).digest('hex');
}
