import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Prisma conectado ao banco com sucesso');
        return;
      } catch (error) {
        this.logger.warn(`Tentativa ${attempt}/${maxAttempts} falhou. Tentando de novo em 3s...`);
        if (attempt === maxAttempts) {
          this.logger.error('Banco inacessivel no boot. Servidor seguira no ar e reconectara a cada query.');
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
