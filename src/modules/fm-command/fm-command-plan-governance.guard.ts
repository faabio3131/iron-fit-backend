import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

const hash = (value: string) => createHash('sha256').update(value).digest();

/**
 * Dedicated credential for governing canonical IRON plan definitions.
 * It MUST NOT be the existing FMCC billing/readback bearer: read-only
 * integrations and subscription workers never acquire plan-write authority.
 */
@Injectable()
export class FmCommandPlanGovernanceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN?.trim();
    const billingSecret = process.env.FMCC_IRON_CONTROL_PLANE_TOKEN?.trim();
    if (!secret || secret.length < 32 || secret === billingSecret) {
      throw new ServiceUnavailableException('Governanca de planos do Command nao configurada');
    }

    const request = context.switchToHttp().getRequest();
    const authorization = String(request.headers?.authorization ?? '');
    const supplied = authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? '';
    if (!supplied || !timingSafeEqual(hash(secret), hash(supplied))) {
      throw new UnauthorizedException('Governanca de planos nao autorizada');
    }

    const correlationId = String(request.headers?.['x-correlation-id'] ?? '');
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(correlationId)) {
      throw new UnauthorizedException('Correlation ID obrigatorio');
    }
    request.fmCommandCorrelationId = correlationId;
    return true;
  }
}
