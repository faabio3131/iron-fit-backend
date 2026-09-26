import { Injectable } from '@nestjs/common';

type HttpMetricSnapshot = {
  requestTotal: number;
  error5xxTotal: number;
  durationTotalMs: number;
  maxDurationMs: number;
};

@Injectable()
export class RuntimeMetricsService {
  private readonly startedAt = Date.now();
  private requestTotal = 0;
  private error5xxTotal = 0;
  private durationTotalMs = 0;
  private maxDurationMs = 0;

  observeHttp(statusCode: number, durationMs: number) {
    this.requestTotal += 1;
    if (statusCode >= 500) this.error5xxTotal += 1;
    this.durationTotalMs += durationMs;
    if (durationMs > this.maxDurationMs) this.maxDurationMs = durationMs;
  }

  snapshot(): HttpMetricSnapshot & {
    uptimeSeconds: number;
    averageDurationMs: number;
    rssBytes: number;
    heapUsedBytes: number;
  } {
    const memory = process.memoryUsage();
    return {
      requestTotal: this.requestTotal,
      error5xxTotal: this.error5xxTotal,
      durationTotalMs: Math.round(this.durationTotalMs * 100) / 100,
      maxDurationMs: Math.round(this.maxDurationMs * 100) / 100,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      averageDurationMs:
        this.requestTotal === 0
          ? 0
          : Math.round((this.durationTotalMs / this.requestTotal) * 100) / 100,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    };
  }
}
