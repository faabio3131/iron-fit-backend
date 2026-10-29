import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ManagerAlertsController } from './manager-alerts.controller';
import { ManagerAlertsService } from './manager-alerts.service';
import { AuthModule } from '../auth/auth.module';
import { ManagerAlertProducersService } from './manager-alert-producers.service';
import { CommunicationModule } from '../communication/communication.module';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ManagerAlertDispatchService } from './manager-alert-dispatch.service';

@Module({
  imports: [PrismaModule, AuthModule, IntegrationsModule, CommunicationModule, TransactionalEmailModule],
  controllers: [ManagerAlertsController],
  providers: [ManagerAlertsService, ManagerAlertProducersService, ManagerAlertDispatchService, AuditService],
  exports: [ManagerAlertsService, ManagerAlertProducersService],
})
export class ManagerAlertsModule {}
