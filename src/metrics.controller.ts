import { Controller, Get, UseGuards } from '@nestjs/common';
import { RuntimeMetricsService } from './common/observability/runtime-metrics.service';
import { MetricsAccessGuard } from './common/guards/metrics-access.guard';
import { runtimeIdentity } from './config/runtime-environment';

@Controller('health')
export class MetricsController {
  constructor(private readonly metrics: RuntimeMetricsService) {}

  @Get('metrics')
  @UseGuards(MetricsAccessGuard)
  metricsSnapshot() {
    const identity = runtimeIdentity();
    return {
      status: 'ok',
      service: identity.service,
      runtimeEnvironment: identity.runtimeEnvironment,
      buildSha: identity.buildSha,
      metrics: this.metrics.snapshot(),
      timestamp: new Date().toISOString(),
    };
  }
}
