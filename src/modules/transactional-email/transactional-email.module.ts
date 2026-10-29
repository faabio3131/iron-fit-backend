import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TransactionalEmailDispatchService } from './transactional-email-dispatch.service';
import { TransactionalEmailProviderAdapterRegistry } from './transactional-email-provider-adapter';
import { ResendEmailAdapter } from './resend-email.adapter';

@Module({
  imports: [PrismaModule, IntegrationsModule],
  providers: [
    AuditService,
    TransactionalEmailProviderAdapterRegistry,
    ResendEmailAdapter,
    TransactionalEmailDispatchService,
  ],
  exports: [
    TransactionalEmailProviderAdapterRegistry,
    TransactionalEmailDispatchService,
  ],
})
export class TransactionalEmailModule {}
