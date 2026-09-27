import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'iron-fit-backend',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'iron-fit-backend',
      probe: 'liveness',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        service: 'iron-fit-backend',
        probe: 'readiness',
        dependencies: { postgres: 'up' },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'iron-fit-backend',
        probe: 'readiness',
        dependencies: { postgres: 'down' },
      });
    }
  }
}
