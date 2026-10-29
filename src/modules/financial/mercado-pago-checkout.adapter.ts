import { Injectable, OnModuleInit } from '@nestjs/common';
import { TenantPaymentProviderAdapterRegistry, TenantPaymentCheckoutInput, TenantPaymentCheckoutResult } from './tenant-payment-provider-adapter';
import { ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class MercadoPagoCheckoutAdapter implements OnModuleInit {
  readonly providerCode = 'mercado_pago';
  constructor(private readonly registry: TenantPaymentProviderAdapterRegistry) {}
  onModuleInit() { this.registry.register(this); }

  async createCheckout(input: TenantPaymentCheckoutInput): Promise<TenantPaymentCheckoutResult> {
    if (input.currency !== 'BRL' || !Number.isSafeInteger(input.amount) || input.amount <= 0)
      throw new ServiceUnavailableException('PAYMENT_AMOUNT_INVALID');
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(input.requestId))
      throw new ServiceUnavailableException('PAYMENT_IDEMPOTENCY_INVALID');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          authorization: 'Bearer ' + input.credential.reveal(),
          'content-type': 'application/json',
          'X-Idempotency-Key': input.requestId,
        },
        body: JSON.stringify({
          items: [{ id: input.chargeId, title: 'Mensalidade da academia', quantity: 1, currency_id: 'BRL', unit_price: input.amount / 100 }],
          external_reference: input.chargeId,
        }),
      });
      if (!response.ok) throw new ServiceUnavailableException('PAYMENT_PROVIDER_HTTP_' + response.status);
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 65536) throw new ServiceUnavailableException('PAYMENT_RESPONSE_TOO_LARGE');
      let result: unknown;
      try { result = JSON.parse(raw); } catch { throw new ServiceUnavailableException('PAYMENT_RESPONSE_INVALID'); }
      const data = result as { id?: unknown; init_point?: unknown };
      if (typeof data?.id !== 'string' || !data.id || typeof data.init_point !== 'string')
        throw new ServiceUnavailableException('PAYMENT_RESPONSE_INVALID');
      const url = new URL(data.init_point);
      if (url.protocol !== 'https:' || !['mercadopago.com', 'www.mercadopago.com', 'mercadopago.com.br', 'www.mercadopago.com.br'].includes(url.hostname))
        throw new ServiceUnavailableException('PAYMENT_CHECKOUT_URL_INVALID');
      return { providerChargeRef: data.id, checkoutUrl: url.toString(), pixQrCode: null, expiresAt: null };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('PAYMENT_PROVIDER_UNAVAILABLE');
    } finally { clearTimeout(timeout); }
  }
}
