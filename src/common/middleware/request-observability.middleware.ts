import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function resolveRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

@Injectable()
export class RequestObservabilityMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = resolveRequestId(req.headers['x-request-id']);
    const startedAt = process.hrtime.bigint();

    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.logger.log(
        JSON.stringify({
          event: 'http_request_completed',
          requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        }),
      );
    });

    next();
  }
}
