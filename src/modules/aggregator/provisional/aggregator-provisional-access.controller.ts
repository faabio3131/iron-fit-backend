import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AggregatorProvisionalAccessService } from './aggregator-provisional-access.service';

@Controller('aggregator/provisional-access')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AggregatorProvisionalAccessController {
  constructor(
    private readonly provisionalAccess: AggregatorProvisionalAccessService,
  ) {}

  @Post(':visitAuthorizationId/decide')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  decide(
    @Param('visitAuthorizationId') visitAuthorizationId: string,
    @CurrentUser() user: any,
  ) {
    return this.provisionalAccess.requestProvisionalAccess(
      visitAuthorizationId,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }

  @Post(':visitAuthorizationId/revalidate')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  revalidate(
    @Param('visitAuthorizationId') visitAuthorizationId: string,
    @CurrentUser() user: any,
  ) {
    return this.provisionalAccess.revalidate(
      visitAuthorizationId,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }
}
