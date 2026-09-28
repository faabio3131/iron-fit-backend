import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommercialLaunchModule } from '../commercial-launch/commercial-launch.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InternalSandboxBillingAdapter } from './adapters/internal-sandbox-billing.adapter';
import { SaasBillingController } from './saas-billing.controller';
import { SaasBillingProviderConnectionService } from './saas-billing-provider-connection.service';
import { SaasBillingProviderRegistry } from './saas-billing-provider.registry';
import { SaasBillingService } from './saas-billing.service';

@Module({
  imports: [ProductEntitlementsModule, CommercialLaunchModule, IntegrationsModule],
  controllers: [SaasBillingController],
  providers: [
    PrismaService,
    AuditService,
    InternalSandboxBillingAdapter,
    SaasBillingProviderRegistry,
    SaasBillingProviderConnectionService,
    SaasBillingService,
  ],
  exports: [SaasBillingService],
})
export class SaasBillingModule {}
