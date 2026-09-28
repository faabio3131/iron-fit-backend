import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { runtimeIdentity } from './config/runtime-environment';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  private identity() {
    return runtimeIdentity();
  }

  @Get()
  check() {
    const identity = this.identity();
    return {
      status: 'ok',
      service: identity.service,
      version: '0.1.0',
      runtimeEnvironment: identity.runtimeEnvironment,
      buildSha: identity.buildSha,
      releaseVersion: identity.releaseVersion,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    const identity = this.identity();
    return {
      status: 'ok',
      service: identity.service,
      probe: 'liveness',
      runtimeEnvironment: identity.runtimeEnvironment,
      buildSha: identity.buildSha,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const identity = this.identity();
      return {
        status: 'ok',
        service: identity.service,
        probe: 'readiness',
        runtimeEnvironment: identity.runtimeEnvironment,
        buildSha: identity.buildSha,
        dependencies: { postgres: 'up' },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'gym-saas-backend',
        probe: 'readiness',
        dependencies: { postgres: 'down' },
      });
    }
  }
}
