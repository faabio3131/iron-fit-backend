import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessReadController } from './access-read.controller';
import { AccessService } from './access.service';
import { AccessReadService } from './access-read.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [AccessController, AccessReadController],
  providers: [AccessService, AccessReadService, PrismaService],
  exports: [AccessService],
})
export class AccessModule {}
