import { Module } from '@nestjs/common';
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TenantPaymentCheckoutService } from './tenant-payment-checkout.service';
import { TenantPaymentProviderAdapterRegistry } from './tenant-payment-provider-adapter';
import { AuthModule } from '../auth/auth.module';
import { FiscalScopeBindingService } from './fiscal-scope-binding.service';
import { FiscalBridgeHttpTransport } from './fiscal-bridge.contract';
import { FiscalBridgeDispatchService } from './fiscal-bridge-dispatch.service';
import { FiscalBridgeMaintenanceService } from './fiscal-bridge-maintenance.service';

@Module({
  imports: [IntegrationsModule, AuthModule],
  controllers: [FinancialController],
  providers: [
    FinancialService,
    TenantPaymentCheckoutService,
    TenantPaymentProviderAdapterRegistry,
    FiscalScopeBindingService,
    FiscalBridgeHttpTransport,
    FiscalBridgeDispatchService,
    FiscalBridgeMaintenanceService,
    PrismaService,
    AuditService,
  ],
  exports: [
    FinancialService,
    TenantPaymentCheckoutService,
    FiscalScopeBindingService,
    FiscalBridgeDispatchService,
  ],
})
export class FinancialModule {}
