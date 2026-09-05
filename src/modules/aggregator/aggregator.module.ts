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
import { WellhubAdapterService } from './providers/wellhub/wellhub-adapter.service';
import { TotalPassAdapterService } from './providers/totalpass/totalpass-adapter.service';

@Module({
  controllers: [
    AggregatorAgreementsController,
    AggregatorEligibilityController,
    AggregatorVisitAuthorizationController,
    AggregatorProvisionalAccessController,
  ],
  providers: [
    AggregatorAgreementsService,
    AggregatorEligibilityService,
    AggregatorVisitAuthorizationService,
    AggregatorProvisionalAccessService,
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
    WellhubAdapterService,
    TotalPassAdapterService,
  ],
})
export class AggregatorModule {}
