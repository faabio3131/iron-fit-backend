import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { InternalSandboxBillingAdapter } from './adapters/internal-sandbox-billing.adapter';
import { SaasBillingController } from './saas-billing.controller';
import { SaasBillingService } from './saas-billing.service';

@Module({
  imports: [ProductEntitlementsModule],
  controllers: [SaasBillingController],
  providers: [
    PrismaService,
    AuditService,
    InternalSandboxBillingAdapter,
    SaasBillingService,
  ],
  exports: [SaasBillingService],
})
export class SaasBillingModule {}
