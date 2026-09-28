import { Module } from '@nestjs/common';
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TenantPaymentCheckoutService } from './tenant-payment-checkout.service';
import { TenantPaymentProviderAdapterRegistry } from './tenant-payment-provider-adapter';

@Module({
  imports: [IntegrationsModule],
  controllers: [FinancialController],
  providers: [
    FinancialService,
    TenantPaymentCheckoutService,
    TenantPaymentProviderAdapterRegistry,
    PrismaService,
    AuditService,
  ],
  exports: [FinancialService, TenantPaymentCheckoutService],
})
export class FinancialModule {}
