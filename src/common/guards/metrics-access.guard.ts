import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class MetricsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (process.env.NODE_ENV !== 'production') return true;

    const configured = process.env.OBSERVABILITY_METRICS_TOKEN?.trim();
    if (!configured || configured.length < 32) {
      throw new UnauthorizedException('Observability access unavailable');
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const presented =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : '';

    if (!presented || !secureEqual(presented, configured)) {
      throw new UnauthorizedException('Observability access unavailable');
    }

    return true;
  }
}
