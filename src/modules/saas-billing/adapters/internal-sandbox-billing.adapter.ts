import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  canonicalBillingPayload,
  SaasBillingProviderPort,
  SaasCheckoutProviderInput,
  SaasCheckoutProviderResult,
  SaasRefundProviderInput,
  SaasRefundProviderResult,
} from '../contracts/saas-billing-provider.port';

@Injectable()
export class InternalSandboxBillingAdapter implements SaasBillingProviderPort {
  readonly code = 'INTERNAL_SANDBOX';

  constructor(private readonly config: ConfigService) {}

  private secret(): string {
    const enabled = this.config.get<string>('SAAS_BILLING_SANDBOX_ENABLED')?.trim() === 'true';
    const environment = this.config.get<string>('NODE_ENV')?.trim() ?? process.env.NODE_ENV ?? 'development';
    const secret = this.config.get<string>('SAAS_BILLING_SANDBOX_SECRET')?.trim();

    if (!enabled || environment === 'production' || !secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        'Provider SaaS billing sandbox indisponivel ou proibido neste ambiente',
      );
    }
    return secret;
  }

  assertAvailable(): void {
    this.secret();
  }

  async createCheckout(
    input: SaasCheckoutProviderInput,
  ): Promise<SaasCheckoutProviderResult> {
    this.assertAvailable();
    const digest = createHash('sha256')
      .update(`${input.requestId}:${input.gymId}:${input.priceCode}:${input.amountMinor}:${input.currency}`)
      .digest('hex')
      .slice(0, 24);

    return {
      providerSessionRef: `sandbox_checkout_${digest}`,
      checkoutUrl: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async requestRefund(
    input: SaasRefundProviderInput,
  ): Promise<SaasRefundProviderResult> {
    this.assertAvailable();
    const digest = createHash('sha256')
      .update(`${input.requestId}:${input.providerPaymentRef}:${input.amountMinor}`)
      .digest('hex')
      .slice(0, 24);
    return {
      providerRefundRef: `sandbox_refund_${digest}`,
      status: 'SUCCEEDED',
    };
  }

  verifyWebhook(payload: unknown, signature?: string): void {
    const secret = this.secret();
    const supplied = (signature ?? '').trim().replace(/^sha256=/i, '');
    if (!/^[0-9a-f]{64}$/i.test(supplied)) {
      throw new UnauthorizedException('Assinatura de webhook SaaS billing invalida');
    }
    const expected = createHmac('sha256', secret)
      .update(canonicalBillingPayload(payload))
      .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const suppliedBuffer = Buffer.from(supplied, 'hex');
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new UnauthorizedException('Assinatura de webhook SaaS billing invalida');
    }
  }
}
