import { Module } from '@nestjs/common';
import { FinancialController } from './financial.controller';
import { StripePaymentWebhookController } from './stripe-payment-webhook.controller';
import { MercadoPagoPaymentWebhookController } from './mercado-pago-payment-webhook.controller';
import { MercadoPagoPaymentWebhookInboxService } from './mercado-pago-payment-webhook-inbox.service';
import { StripePaymentWebhookInboxService } from './stripe-payment-webhook-inbox.service';
import { FinancialService } from './financial.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TenantPaymentCheckoutService } from './tenant-payment-checkout.service';
import { TenantPaymentReconciliationService } from './tenant-payment-reconciliation.service';
import { TenantPaymentWebhookReconcileService } from './tenant-payment-webhook-reconcile.service';
import { TenantPaymentProviderAdapterRegistry } from './tenant-payment-provider-adapter';
import { MercadoPagoCheckoutAdapter } from './mercado-pago-checkout.adapter';
import { StripeCheckoutAdapter } from './stripe-checkout.adapter';
import { AuthModule } from '../auth/auth.module';
import { FiscalScopeBindingService } from './fiscal-scope-binding.service';
import { FiscalBridgeHttpTransport } from './fiscal-bridge.contract';
import { FiscalBridgeDispatchService } from './fiscal-bridge-dispatch.service';
import { FiscalBridgeMaintenanceService } from './fiscal-bridge-maintenance.service';
import { FiscalReconciliationCancellationService } from './fiscal-reconciliation-cancellation.service';

@Module({
  imports: [PrismaModule, IntegrationsModule, AuthModule],
  controllers: [FinancialController, StripePaymentWebhookController, MercadoPagoPaymentWebhookController],
  providers: [
    FinancialService,
    StripePaymentWebhookInboxService,
    MercadoPagoPaymentWebhookInboxService,
    TenantPaymentCheckoutService,
    TenantPaymentReconciliationService,
    TenantPaymentWebhookReconcileService,
    TenantPaymentProviderAdapterRegistry,
    MercadoPagoCheckoutAdapter,
    StripeCheckoutAdapter,
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
