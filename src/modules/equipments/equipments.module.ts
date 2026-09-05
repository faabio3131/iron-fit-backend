import { Module } from '@nestjs/common';
import { EquipmentsController } from './equipments.controller';
import { EquipmentsService } from './equipments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

@Module({
  controllers: [EquipmentsController],
  providers: [EquipmentsService, PrismaService, AuditService],
  exports: [EquipmentsService],
})
export class EquipmentsModule {}
