import { Module } from '@nestjs/common';
import { EquipmentsController } from './equipments.controller';
import { EquipmentsService } from './equipments.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [EquipmentsController],
  providers: [EquipmentsService, PrismaService],
  exports: [EquipmentsService],
})
export class EquipmentsModule {}
