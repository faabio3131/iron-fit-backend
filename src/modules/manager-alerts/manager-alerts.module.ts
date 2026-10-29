import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ManagerAlertsController } from './manager-alerts.controller';
import { ManagerAlertsService } from './manager-alerts.service';
import { AuthModule } from '../auth/auth.module';
import { ManagerAlertProducersService } from './manager-alert-producers.service';
import { ManagerAlertSourceScanService } from './manager-alert-source-scan.service';
import { ManagerAlertBusinessScanService } from './manager-alert-business-scan.service';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { CommunicationModule } from '../communication/communication.module';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ManagerAlertDispatchService } from './manager-alert-dispatch.service';
import { EvolutionTenantInstanceController, EvolutionWebhookController } from './evolution-tenant-instance.controller';
import { EvolutionTenantInstanceService } from './evolution-tenant-instance.service';

@Module({
  imports: [PrismaModule, AuthModule, IntegrationsModule, CommunicationModule, TransactionalEmailModule, ProductEntitlementsModule],
  controllers: [ManagerAlertsController, EvolutionTenantInstanceController, EvolutionWebhookController],
  providers: [ManagerAlertsService, ManagerAlertProducersService, ManagerAlertSourceScanService, ManagerAlertBusinessScanService, ManagerAlertDispatchService, EvolutionTenantInstanceService, AuditService],
  exports: [ManagerAlertsService, ManagerAlertProducersService],
})
export class ManagerAlertsModule {}
