import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import {
  TenantPaymentProviderAdapterRegistry,
  TenantPaymentCheckoutInput,
  TenantPaymentCheckoutResult,
} from './tenant-payment-provider-adapter';

function urlForConfig(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) {
    throw new ServiceUnavailableException('STRIPE_REDIRECT_CONFIGURATION_INVALID');
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('invalid');
    }
    return url.toString();
  } catch {
    throw new ServiceUnavailableException('STRIPE_REDIRECT_CONFIGURATION_INVALID');
  }
}

@Injectable()
export class StripeCheckoutAdapter implements OnModuleInit {
  readonly providerCode = 'stripe';

  constructor(private readonly registry: TenantPaymentProviderAdapterRegistry) {}
  onModuleInit() { this.registry.register(this); }

  async createCheckout(input: TenantPaymentCheckoutInput): Promise<TenantPaymentCheckoutResult> {
    if (input.currency !== 'BRL' || !Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new ServiceUnavailableException('PAYMENT_AMOUNT_INVALID');
    }
    if (!/^[a-f0-9-]{36}$/i.test(input.requestId)) {
      throw new ServiceUnavailableException('PAYMENT_IDEMPOTENCY_INVALID');
    }
    if (!input.publicConfiguration || typeof input.publicConfiguration !== 'object' || Array.isArray(input.publicConfiguration)) {
      throw new ServiceUnavailableException('STRIPE_CONFIGURATION_MISSING');
    }
    const config = input.publicConfiguration as Record<string, unknown>;
    const successUrl = urlForConfig(config.successUrl);
    const cancelUrl = urlForConfig(config.cancelUrl);
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: input.chargeId,
      'line_items[0][price_data][currency]': 'brl',
      'line_items[0][price_data][unit_amount]': String(input.amount),
      'line_items[0][price_data][product_data][name]': 'Mensalidade da academia',
      'line_items[0][quantity]': '1',
      'metadata[iron_charge_id]': input.chargeId,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: 'Bearer ' + input.credential.reveal(),
          'content-type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': input.requestId,
        },
        body: body.toString(),
      });
      if (!response.ok) {
        throw new ServiceUnavailableException('STRIPE_HTTP_' + response.status);
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > 65536) {
        throw new ServiceUnavailableException('STRIPE_RESPONSE_TOO_LARGE');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ServiceUnavailableException('STRIPE_RESPONSE_INVALID');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ServiceUnavailableException('STRIPE_RESPONSE_INVALID');
      }
      const data = parsed as Record<string, unknown>;
      if (typeof data.id !== 'string' || !data.id.startsWith('cs_') || data.id.length > 512 ||
          typeof data.url !== 'string') {
        throw new ServiceUnavailableException('STRIPE_RESPONSE_INVALID');
      }
      let checkoutUrl: URL;
      try {
        checkoutUrl = new URL(data.url);
      } catch {
        throw new ServiceUnavailableException('STRIPE_CHECKOUT_URL_INVALID');
      }
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
        throw new ServiceUnavailableException('STRIPE_CHECKOUT_URL_INVALID');
      }
      const expiresAt = typeof data.expires_at === 'number' && Number.isSafeInteger(data.expires_at)
        ? new Date(data.expires_at * 1000)
        : null;
      return {
        providerChargeRef: data.id,
        checkoutUrl: checkoutUrl.toString(),
        pixQrCode: null,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('STRIPE_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
}
