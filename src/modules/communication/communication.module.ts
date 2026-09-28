import { Module } from '@nestjs/common';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import {
  ExternalCommunicationAdapterRegistry,
  MetaWhatsAppCommunicationAdapter,
} from './communication-dispatch-adapter';
import { CommunicationDispatchService } from './communication-dispatch.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [CommunicationController],
  providers: [
    CommunicationService,
    CommunicationDispatchService,
    ExternalCommunicationAdapterRegistry,
    MetaWhatsAppCommunicationAdapter,
    PrismaService,
    AuditService,
  ],
  exports: [CommunicationService, CommunicationDispatchService],
})
export class CommunicationModule {}
