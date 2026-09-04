import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AggregatorEligibilityService } from './aggregator-eligibility.service';

@Controller('aggregator/eligibility')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AggregatorEligibilityController {
  constructor(private readonly eligibility: AggregatorEligibilityService) {}

  @Get('member/:memberId/current')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  current(@Param('memberId') memberId: string, @CurrentUser() user: any) {
    return this.eligibility.findCurrent(
      memberId,
      user.activeGymId ?? user.gymId,
    );
  }
}
