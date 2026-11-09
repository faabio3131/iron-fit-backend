import {
  BadGatewayException, Body, Controller, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

class AiCreditCheckoutRequest {
  @IsIn(['IRON_AI_WORKOUT_100','IRON_AI_WORKOUT_300','IRON_AI_WORKOUT_1000'])
  packageCode!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  requestId!: string;
}

@Controller('ai/credits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class AiCreditCheckoutController {
  @Post('checkout')
  async checkout(@CurrentUser() user: any, @Body() dto: AiCreditCheckoutRequest) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    const endpoint = process.env.FMCC_IRON_CREDITS_CHECKOUT_URL;
    const token = process.env.FMCC_IRON_CREDITS_CHECKOUT_TOKEN?.trim();
    if (!endpoint || !token || token.length < 32)
      throw new ServiceUnavailableException('Checkout de creditos IA nao configurado');
    let url: URL;
    try { url = new URL(endpoint); }
    catch { throw new ServiceUnavailableException('Checkout de creditos IA indisponivel'); }
    // Fixed server-side URL: never forward arbitrary tenant-provided destinations or credentials.
    if (url.protocol !== 'https:' ||
      url.pathname !== '/api/internal/iron/ai-credits/checkout' ||
      url.search || url.hash || url.username || url.password ||
      !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      url.hostname === 'localhost' || /^[0-9.]+$/.test(url.hostname) ||
      url.hostname.endsWith('.localhost') || url.hostname.endsWith('.internal') ||
      url.hostname.endsWith('.local')) {
      throw new ServiceUnavailableException('Checkout de creditos IA indisponivel');
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
          'idempotency-key': dto.requestId },
        body: JSON.stringify({ gymId, packageCode: dto.packageCode }),
        redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
    } catch { throw new ServiceUnavailableException('FM Command indisponivel'); }
    if (!response.ok) throw new BadGatewayException('Checkout de creditos nao autorizado pelo FM Command');
    let result: any;
    try {
      const text = await response.text();
      if (text.length > 4096) throw new Error('oversize');
      result = JSON.parse(text);
    } catch { throw new BadGatewayException('Resposta do checkout invalida'); }
    let checkoutUrl: URL;
    try { checkoutUrl = new URL(result.checkoutUrl); }
    catch { throw new BadGatewayException('Checkout indisponivel'); }
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'pay.cakto.com.br'
      || checkoutUrl.username || checkoutUrl.password || checkoutUrl.hash
      || !/^[0-9a-f-]{36}$/i.test(checkoutUrl.searchParams.get('sck') ?? '')) {
      throw new BadGatewayException('Checkout externo invalido');
    }
    return {
      checkoutUrl: checkoutUrl.toString(), invoiceId: result.invoiceId,
      packageCode: dto.packageCode, amountMinor: result.amountMinor,
      units: result.units, currency: 'BRL', status: result.status,
    };
  }
}
