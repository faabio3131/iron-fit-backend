import { Module } from '@nestjs/common';
import { EquipmentsController } from './equipments.controller';
import { EquipmentsService } from './equipments.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../../common/audit/audit.service';

@Module({
  imports: [PrismaModule],
  controllers: [EquipmentsController],
  providers: [EquipmentsService, AuditService],
  exports: [EquipmentsService],
})
export class EquipmentsModule {}
