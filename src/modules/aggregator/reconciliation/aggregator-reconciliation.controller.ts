import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AggregatorReconciliationService } from './aggregator-reconciliation.service';

@Controller('aggregator/reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AggregatorReconciliationController {
  constructor(private readonly reconciliation: AggregatorReconciliationService) {}

  @Post('visits/:visitAuthorizationId/access-events/:accessEventId/link')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  linkPhysicalEntry(
    @Param('visitAuthorizationId') visitAuthorizationId: string,
    @Param('accessEventId') accessEventId: string,
    @CurrentUser() user: any,
  ) {
    return this.reconciliation.linkPhysicalEntry(
      visitAuthorizationId,
      accessEventId,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }

  @Post('visits/:visitAuthorizationId/run')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  reconcileVisit(
    @Param('visitAuthorizationId') visitAuthorizationId: string,
    @CurrentUser() user: any,
  ) {
    return this.reconciliation.reconcileVisit(
      visitAuthorizationId,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }

  @Post('settlements/:settlementId/run')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  reconcileSettlement(
    @Param('settlementId') settlementId: string,
    @CurrentUser() user: any,
  ) {
    return this.reconciliation.reconcileSettlement(
      settlementId,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }
}
