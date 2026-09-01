import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [AccessController],
  providers: [AccessService, PrismaService],
  exports: [AccessService],
})
export class AccessModule {}
