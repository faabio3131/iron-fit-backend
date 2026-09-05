import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AggregatorAgreementsController } from './agreements/aggregator-agreements.controller';
import { AggregatorAgreementsService } from './agreements/aggregator-agreements.service';
import { AggregatorEligibilityController } from './eligibility/aggregator-eligibility.controller';
import { AggregatorEligibilityService } from './eligibility/aggregator-eligibility.service';
import { AggregatorVisitAuthorizationController } from './visits/aggregator-visit-authorization.controller';
import { AggregatorVisitAuthorizationService } from './visits/aggregator-visit-authorization.service';
import { AggregatorProvisionalAccessController } from './provisional/aggregator-provisional-access.controller';
import { AggregatorProvisionalAccessService } from './provisional/aggregator-provisional-access.service';
import { AggregatorSettlementController } from './settlements/aggregator-settlement.controller';
import { AggregatorSettlementLedgerService } from './settlements/aggregator-settlement-ledger.service';
import { AggregatorReconciliationController } from './reconciliation/aggregator-reconciliation.controller';
import { AggregatorReconciliationService } from './reconciliation/aggregator-reconciliation.service';
import { AggregatorOperationsController } from './operations/aggregator-operations.controller';
import { AggregatorOperationsService } from './operations/aggregator-operations.service';
import { AggregatorIntelligenceController } from './intelligence/aggregator-intelligence.controller';
import { AggregatorIntelligenceService } from './intelligence/aggregator-intelligence.service';
import { WellhubAdapterService } from './providers/wellhub/wellhub-adapter.service';
import { TotalPassAdapterService } from './providers/totalpass/totalpass-adapter.service';

@Module({
  controllers: [
    AggregatorAgreementsController,
    AggregatorEligibilityController,
    AggregatorVisitAuthorizationController,
    AggregatorProvisionalAccessController,
    AggregatorSettlementController,
    AggregatorReconciliationController,
    AggregatorOperationsController,
    AggregatorIntelligenceController,
  ],
  providers: [
    AggregatorAgreementsService,
    AggregatorEligibilityService,
    AggregatorVisitAuthorizationService,
    AggregatorProvisionalAccessService,
    AggregatorSettlementLedgerService,
    AggregatorReconciliationService,
    AggregatorOperationsService,
    AggregatorIntelligenceService,
    WellhubAdapterService,
    TotalPassAdapterService,
    PrismaService,
    AuditService,
  ],
  exports: [
    AggregatorAgreementsService,
    AggregatorEligibilityService,
    AggregatorVisitAuthorizationService,
    AggregatorProvisionalAccessService,
    AggregatorSettlementLedgerService,
    AggregatorReconciliationService,
    WellhubAdapterService,
    TotalPassAdapterService,
  ],
})
export class AggregatorModule {}
