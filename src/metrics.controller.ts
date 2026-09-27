import { Controller, Get } from '@nestjs/common';
import { RuntimeMetricsService } from './common/observability/runtime-metrics.service';

@Controller('health')
export class MetricsController {
  constructor(private readonly metrics: RuntimeMetricsService) {}

  @Get('metrics')
  metricsSnapshot() {
    return {
      status: 'ok',
      service: 'gym-saas-backend',
      metrics: this.metrics.snapshot(),
      timestamp: new Date().toISOString(),
    };
  }
}
