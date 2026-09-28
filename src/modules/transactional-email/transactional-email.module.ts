import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TransactionalEmailDispatchService } from './transactional-email-dispatch.service';
import { TransactionalEmailProviderAdapterRegistry } from './transactional-email-provider-adapter';

@Module({
  imports: [IntegrationsModule],
  providers: [
    PrismaService,
    AuditService,
    TransactionalEmailProviderAdapterRegistry,
    TransactionalEmailDispatchService,
  ],
  exports: [
    TransactionalEmailProviderAdapterRegistry,
    TransactionalEmailDispatchService,
  ],
})
export class TransactionalEmailModule {}
