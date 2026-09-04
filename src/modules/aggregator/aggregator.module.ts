import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AggregatorAgreementsController } from './agreements/aggregator-agreements.controller';
import { AggregatorAgreementsService } from './agreements/aggregator-agreements.service';
import { AggregatorEligibilityController } from './eligibility/aggregator-eligibility.controller';
import { AggregatorEligibilityService } from './eligibility/aggregator-eligibility.service';
import { AggregatorVisitAuthorizationController } from './visits/aggregator-visit-authorization.controller';
import { AggregatorVisitAuthorizationService } from './visits/aggregator-visit-authorization.service';
import { WellhubAdapterService } from './providers/wellhub/wellhub-adapter.service';

@Module({
  controllers: [
    AggregatorAgreementsController,
    AggregatorEligibilityController,
    AggregatorVisitAuthorizationController,
  ],
  providers: [
    AggregatorAgreementsService,
    AggregatorEligibilityService,
    AggregatorVisitAuthorizationService,
    WellhubAdapterService,
    PrismaService,
    AuditService,
  ],
  exports: [
    AggregatorAgreementsService,
    AggregatorEligibilityService,
    AggregatorVisitAuthorizationService,
    WellhubAdapterService,
  ],
})
export class AggregatorModule {}
