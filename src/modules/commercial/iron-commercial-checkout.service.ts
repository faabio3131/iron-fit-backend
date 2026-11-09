import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantProductSubscriptionStatus } from '@prisma/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * The authenticated IRON owner owns the tenant; FM Command owns billing.
 * This adapter never changes local entitlements or creates financial records.
 * Cakto purchase only creates an external hosted-checkout URL for a prepared
 * canonical FM Command invoice. Actual license activation requires signed
 * Cakto webhook -> canonical Command ledger -> authenticated S2S outbox.
 */
@Injectable()
export class IronCommercialCheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  private config() {
    const base = process.env.IRON_FMCC_COMMERCE_URL?.trim();
    const token = process.env.IRON_FMCC_COMMERCE_TOKEN?.trim();
    if (!base || !token || token.length < 32)
      throw new ServiceUnavailableException('Checkout comercial nao configurado');
    let url: URL;
    try { url = new URL(base); }
    catch { throw new ServiceUnavailableException('Checkout comercial nao configurado'); }
    if (url.protocol !== 'https:' || url.hostname !== 'app.fmcommand.com.br' ||
        url.pathname !== '/api/internal/iron/commerce/checkout' ||
        url.username || url.password || url.search || url.hash) {
      throw new ServiceUnavailableException('Endereco do FM Command nao autorizado');
    }
    return { url: url.toString(), token };
  }

  async offers(gymId: string | undefined) {
    if (!gymId || !UUID.test(gymId)) throw new BadRequestException('Academia ativa obrigatoria');
    const conf = this.config();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(conf.url, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'Authorization': 'Bearer ' + conf.token },
      });
    } catch {
      throw new ServiceUnavailableException('Catalogo comercial temporariamente indisponivel');
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new ServiceUnavailableException('Nao foi possivel consultar os planos comerciais');
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new ServiceUnavailableException('Resposta do catalogo invalida'); }
    if (!result || typeof result !== 'object' || !Array.isArray((result as any).plans))
      throw new ServiceUnavailableException('Resposta do catalogo invalida');
    const plans = (result as { plans: unknown[] }).plans;
    if (plans.length > 30) throw new ServiceUnavailableException('Catalogo comercial excedeu o limite');
    return { plans: plans.map((plan) => {
      if (!plan || typeof plan !== 'object' || Array.isArray(plan))
        throw new ServiceUnavailableException('Plano comercial malformado');
      const p = plan as Record<string, unknown>;
      if (typeof p.planCode !== 'string' || !PLAN.test(p.planCode) ||
          typeof p.name !== 'string' || p.name.length < 2 || p.name.length > 120 ||
          !['monthly', 'yearly'].includes(String(p.interval)) ||
          typeof p.amountMinor !== 'number' || !Number.isSafeInteger(p.amountMinor) ||
          p.amountMinor <= 0 || p.currency !== 'BRL')
        throw new ServiceUnavailableException('Plano comercial malformado');
      return {
        planCode: p.planCode, name: p.name, interval: p.interval,
        amountMinor: p.amountMinor, currency: 'BRL',
      };
    }) };
  }

  async prepare(gymId: string | undefined, planCode: string, requestId: string) {
    if (!gymId || !UUID.test(gymId)) throw new BadRequestException('Academia ativa obrigatoria');
    if (!PLAN.test(planCode) || !UUID.test(requestId))
      throw new BadRequestException('Plano ou chave de requisicao invalida');

    const current = await this.prisma.tenantProductSubscription.findFirst({
      where: { gymId, status: TenantProductSubscriptionStatus.ACTIVE },
      select: { id: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!current) throw new ConflictException('Academia sem assinatura ativa para contratar');
    const conf = this.config();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(conf.url, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: {
          'Authorization': 'Bearer ' + conf.token,
          'Content-Type': 'application/json',
          'X-Correlation-ID': requestId,
        },
        body: JSON.stringify({
          gymId, expectedSubscriptionId: current.id, planCode, idempotencyKey: requestId,
        }),
      });
    } catch {
      throw new ServiceUnavailableException('FM Command indisponivel para contratar');
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      throw new ServiceUnavailableException('Nao foi possivel preparar o checkout na autoridade comercial');
    }
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new ServiceUnavailableException('Resposta de checkout invalida'); }
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new ServiceUnavailableException('Resposta de checkout invalida');
    const data = result as Record<string, unknown>;
    if (data.productCode !== 'IRON_FIT_CORE' || typeof data.invoiceId !== 'string' ||
        !UUID.test(data.invoiceId) || typeof data.checkoutUrl !== 'string') {
      throw new ServiceUnavailableException('FM Command retornou checkout sem fatura');
    }
    let checkout: URL;
    try { checkout = new URL(data.checkoutUrl); }
    catch { throw new ServiceUnavailableException('Checkout comercial invalido'); }
    if (checkout.protocol !== 'https:' || checkout.hostname !== 'pay.cakto.com.br' ||
        checkout.username || checkout.password || checkout.hash ||
        checkout.searchParams.get('sck') !== data.invoiceId) {
      throw new ServiceUnavailableException('Checkout sem referencia canonica de fatura');
    }
    return {
      checkoutUrl: checkout.toString(),
      provider: 'CAKTO',
      productCode: 'IRON_FIT_CORE',
      pendingConfirmation: true,
    };
  }
}
