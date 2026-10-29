import { Module } from '@nestjs/common';
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TenantPaymentCheckoutService } from './tenant-payment-checkout.service';
import { TenantPaymentProviderAdapterRegistry } from './tenant-payment-provider-adapter';
import { MercadoPagoCheckoutAdapter } from './mercado-pago-checkout.adapter';
import { AuthModule } from '../auth/auth.module';
import { FiscalScopeBindingService } from './fiscal-scope-binding.service';
import { FiscalBridgeHttpTransport } from './fiscal-bridge.contract';
import { FiscalBridgeDispatchService } from './fiscal-bridge-dispatch.service';
import { FiscalBridgeMaintenanceService } from './fiscal-bridge-maintenance.service';
import { FiscalReconciliationCancellationService } from './fiscal-reconciliation-cancellation.service';

@Module({
  imports: [PrismaModule, IntegrationsModule, AuthModule],
  controllers: [FinancialController],
  providers: [
    FinancialService,
    TenantPaymentCheckoutService,
    TenantPaymentProviderAdapterRegistry,
    MercadoPagoCheckoutAdapter,
    FiscalScopeBindingService,
    FiscalBridgeHttpTransport,
    FiscalBridgeDispatchService,
    FiscalBridgeMaintenanceService,
    FiscalReconciliationCancellationService,
    AuditService,
  ],
  exports: [
    FinancialService,
    TenantPaymentCheckoutService,
    FiscalScopeBindingService,
    FiscalBridgeDispatchService,
    FiscalReconciliationCancellationService,
  ],
})
export class FinancialModule {}
