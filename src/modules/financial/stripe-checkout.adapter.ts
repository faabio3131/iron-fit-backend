import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import {
  TenantPaymentProviderAdapterRegistry,
  TenantPaymentCheckoutInput,
  TenantPaymentCheckoutResult,
  TenantPaymentVerificationInput,
  TenantPaymentVerificationResult,
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

  async verifyCheckout(input: TenantPaymentVerificationInput): Promise<TenantPaymentVerificationResult> {
    if (!/^cs_[a-zA-Z0-9_]{1,120}$/.test(input.providerChargeRef)) {
      throw new ServiceUnavailableException('STRIPE_SESSION_INVALID');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(
        'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(input.providerChargeRef),
        {
          method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { authorization: 'Bearer ' + input.credential.reveal() },
        },
      );
      if (!response.ok) throw new ServiceUnavailableException('STRIPE_VERIFICATION_HTTP_' + response.status);
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > 65536) throw new ServiceUnavailableException('STRIPE_VERIFICATION_TOO_LARGE');
      let data: any;
      try { data = JSON.parse(raw); } catch { throw new ServiceUnavailableException('STRIPE_VERIFICATION_INVALID'); }
      if (!data || data.id !== input.providerChargeRef || data.mode !== 'payment' ||
          data.client_reference_id !== input.chargeId || data.metadata?.iron_charge_id !== input.chargeId ||
          data.amount_total !== input.amount || data.currency !== input.currency.toLowerCase() ||
          data.livemode !== (input.environment === 'PROD')) {
        throw new ServiceUnavailableException('STRIPE_VERIFICATION_MISMATCH');
      }
      if (data.payment_status === 'paid' && data.status === 'complete') {
        // A completed Checkout Session alone does not prove that its
        // underlying PaymentIntent has not since been refunded or disputed.
        if (typeof data.payment_intent !== 'string' ||
            !/^pi_[a-zA-Z0-9_]{1,120}$/.test(data.payment_intent)) {
          throw new ServiceUnavailableException('STRIPE_PAYMENT_INTENT_MISSING');
        }
        const detailsUrl = 'https://api.stripe.com/v1/payment_intents/' +
          encodeURIComponent(data.payment_intent) + '?expand%5B%5D=latest_charge';
        const paymentResponse = await fetch(detailsUrl, {
          method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { authorization: 'Bearer ' + input.credential.reveal() },
        });
        if (!paymentResponse.ok) {
          throw new ServiceUnavailableException('STRIPE_PAYMENT_INTENT_HTTP_' + paymentResponse.status);
        }
        const paymentRaw = await paymentResponse.text();
        if (Buffer.byteLength(paymentRaw, 'utf8') > 65536) {
          throw new ServiceUnavailableException('STRIPE_PAYMENT_INTENT_TOO_LARGE');
        }
        let intent: any;
        try { intent = JSON.parse(paymentRaw); } catch {
          throw new ServiceUnavailableException('STRIPE_PAYMENT_INTENT_INVALID');
        }
        if (!intent || intent.id !== data.payment_intent ||
            intent.currency !== input.currency.toLowerCase() ||
            intent.amount !== input.amount ||
            intent.livemode !== (input.environment === 'PROD')) {
          throw new ServiceUnavailableException('STRIPE_PAYMENT_INTENT_MISMATCH');
        }
        if (intent.status !== 'succeeded' || intent.amount_received !== input.amount) {
          return { status: 'PENDING', providerPaymentRef: intent.id, paidAt: null };
        }
        const latestCharge = intent.latest_charge;
        if (!latestCharge || typeof latestCharge !== 'object' ||
            latestCharge.payment_intent !== intent.id ||
            typeof latestCharge.id !== 'string') {
          throw new ServiceUnavailableException('STRIPE_CHARGE_NOT_VERIFIED');
        }
        const refundMinor = latestCharge.amount_refunded;
        if (!Number.isSafeInteger(refundMinor) || refundMinor < 0 || refundMinor > input.amount) {
          throw new ServiceUnavailableException('STRIPE_REFUND_AMOUNT_INVALID');
        }
        if (latestCharge.disputed === true) {
          return { status: 'REVERSED', reversalReason: 'CHARGEBACK',
            reversedAmount: refundMinor, providerPaymentRef: intent.id, paidAt: null };
        }
        if (latestCharge.refunded === true || refundMinor > 0) {
          return {
            status: 'REVERSED',
            reversalReason: refundMinor === input.amount ? 'FULL_REFUND' : 'PARTIAL_REFUND',
            reversedAmount: refundMinor,
            providerPaymentRef: intent.id, paidAt: null,
          };
        }
        if (latestCharge.paid !== true || latestCharge.status !== 'succeeded' ||
            latestCharge.amount !== input.amount || latestCharge.currency !== input.currency.toLowerCase()) {
          throw new ServiceUnavailableException('STRIPE_CHARGE_NOT_VERIFIED');
        }
        return { status: 'PAID', providerPaymentRef: intent.id, paidAt: null };
      }
      if (data.status === 'expired') return { status: 'REVERSED', reversalReason: 'EXPIRED', reversedAmount: 0, providerPaymentRef: data.id, paidAt: null };
      return { status: 'PENDING', providerPaymentRef: data.id, paidAt: null };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('STRIPE_VERIFICATION_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

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
