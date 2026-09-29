import { Module } from '@nestjs/common';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import {
  ExternalCommunicationAdapterRegistry,
  MetaWhatsAppCommunicationAdapter,
} from './communication-dispatch-adapter';
import { CommunicationDispatchService } from './communication-dispatch.service';

@Module({
  imports: [PrismaModule, IntegrationsModule],
  controllers: [CommunicationController],
  providers: [
    CommunicationService,
    CommunicationDispatchService,
    ExternalCommunicationAdapterRegistry,
    MetaWhatsAppCommunicationAdapter,
    AuditService,
  ],
  exports: [CommunicationService, CommunicationDispatchService],
})
export class CommunicationModule {}
