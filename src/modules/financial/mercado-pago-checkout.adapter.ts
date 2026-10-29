import { Injectable, OnModuleInit } from '@nestjs/common';
import { TenantPaymentProviderAdapterRegistry, TenantPaymentCheckoutInput, TenantPaymentCheckoutResult, TenantPaymentVerificationInput, TenantPaymentVerificationResult } from './tenant-payment-provider-adapter';
import { ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class MercadoPagoCheckoutAdapter implements OnModuleInit {
  readonly providerCode = 'mercado_pago';
  constructor(private readonly registry: TenantPaymentProviderAdapterRegistry) {}
  onModuleInit() { this.registry.register(this); }

  async verifyCheckout(input: TenantPaymentVerificationInput): Promise<TenantPaymentVerificationResult> {
    // A Checkout Pro preference is not a payment. Look up the actual payment
    // under the same tenant merchant token and confirm the full amount.
    if (!input.chargeId || input.currency !== 'BRL') {
      throw new ServiceUnavailableException('PAYMENT_VERIFICATION_INVALID');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const headers = { authorization: 'Bearer ' + input.credential.reveal(), accept: 'application/json' };
    const read = async (url: string) => {
      const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new ServiceUnavailableException('PAYMENT_VERIFICATION_HTTP_' + response.status);
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > 65536) throw new ServiceUnavailableException('PAYMENT_VERIFICATION_TOO_LARGE');
      try { return JSON.parse(raw) as Record<string, any>; } catch {
        throw new ServiceUnavailableException('PAYMENT_VERIFICATION_INVALID_RESPONSE');
      }
    };
    try {
      const search = new URL('https://api.mercadopago.com/v1/payments/search');
      search.searchParams.set('external_reference', input.chargeId);
      search.searchParams.set('sort', 'date_created');
      search.searchParams.set('criteria', 'desc');
      search.searchParams.set('limit', '50');
      const result = await read(search.toString());
      if (!Array.isArray(result?.results) || (typeof result.paging?.total === 'number' && result.paging.total > 50)) {
        throw new ServiceUnavailableException('PAYMENT_VERIFICATION_AMBIGUOUS');
      }
      const rows = result.results.filter((row: any) => row?.external_reference === input.chargeId);
      if (rows.length === 0) return { status: 'PENDING', providerPaymentRef: null, paidAt: null };
      if (rows.length !== 1 || !/^\d{1,25}$/.test(String(rows[0].id ?? ''))) {
        throw new ServiceUnavailableException('PAYMENT_VERIFICATION_AMBIGUOUS');
      }
      const payment = await read('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(String(rows[0].id)));
      const value = payment.transaction_amount;
      const minor = typeof value === 'number' && Number.isFinite(value) ? value * 100 : NaN;
      if (String(payment.id) !== String(rows[0].id) ||
          payment.external_reference !== input.chargeId ||
          payment.currency_id !== 'BRL' ||
          !Number.isSafeInteger(input.amount) ||
          !Number.isFinite(minor) || Math.abs(minor - input.amount) > 0.000001) {
        throw new ServiceUnavailableException('PAYMENT_VERIFICATION_MISMATCH');
      }
      const rawRefund = payment.amount_refunded ?? 0;
      const refundMinor = typeof rawRefund === 'number' && Number.isFinite(rawRefund)
        ? Math.round(rawRefund * 100) : NaN;
      if (!Number.isSafeInteger(refundMinor) || refundMinor < 0 || refundMinor > input.amount ||
          Math.abs(refundMinor - rawRefund * 100) > 0.000001) {
        throw new ServiceUnavailableException('PAYMENT_REFUND_AMOUNT_INVALID');
      }
      if (payment.status === 'charged_back') {
        return { status: 'REVERSED', reversalReason: 'CHARGEBACK',
          reversedAmount: refundMinor, providerPaymentRef: String(payment.id), paidAt: null };
      }
      if (payment.status === 'refunded' || refundMinor > 0) {
        return {
          status: 'REVERSED',
          reversalReason: refundMinor === input.amount ? 'FULL_REFUND' : 'PARTIAL_REFUND',
          reversedAmount: refundMinor, providerPaymentRef: String(payment.id), paidAt: null,
        };
      }
      if (payment.status === 'cancelled') {
        return { status: 'REVERSED', reversalReason: 'CANCELLED',
          reversedAmount: 0, providerPaymentRef: String(payment.id), paidAt: null };
      }
      if (payment.status === 'approved' && payment.status_detail === 'accredited') {
        const date = typeof payment.date_approved === 'string' ? new Date(payment.date_approved) : null;
        return { status: 'PAID', providerPaymentRef: String(payment.id), paidAt: date && !Number.isNaN(date.getTime()) ? date : null };
      }
      return { status: 'PENDING', providerPaymentRef: String(payment.id), paidAt: null };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('PAYMENT_VERIFICATION_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

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
