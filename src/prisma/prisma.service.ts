import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  onModuleInit() {
    void this.$connect()
      .then(() => {
        this.logger.log('Prisma conectado ao banco com sucesso');
      })
      .catch(() => {
        this.logger.error(
          'Banco inacessivel no boot. Servidor seguira no ar e reconectara a cada query.',
        );
      });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
