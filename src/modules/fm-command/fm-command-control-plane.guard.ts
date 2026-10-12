import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

@Injectable()
export class FmCommandControlPlaneGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.FMCC_IRON_CONTROL_PLANE_TOKEN?.trim();
    if (!configured || configured.length < 32) {
      throw new ServiceUnavailableException('FM Command control-plane indisponivel');
    }

    const request = context.switchToHttp().getRequest();
    const authorization = String(request.headers?.authorization ?? '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const supplied = match?.[1]?.trim() ?? '';

    if (!supplied || !timingSafeEqual(digest(configured), digest(supplied))) {
      throw new UnauthorizedException('FM Command control-plane nao autorizado');
    }

    const correlationId = String(request.headers?.['x-correlation-id'] ?? '').trim();
    if (!correlationId || correlationId.length > 128) {
      throw new UnauthorizedException('Correlation ID obrigatorio');
    }

    request.fmCommandCorrelationId = correlationId;
    return true;
  }
}
