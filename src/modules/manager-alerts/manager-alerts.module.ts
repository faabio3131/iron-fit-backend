import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ManagerAlertsController } from './manager-alerts.controller';
import { ManagerAlertsService } from './manager-alerts.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ManagerAlertsController],
  providers: [ManagerAlertsService, AuditService],
  exports: [ManagerAlertsService],
})
export class ManagerAlertsModule {}
