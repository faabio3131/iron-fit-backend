import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AggregatorAnalyticsQueryDto } from './dto/aggregator-analytics-query.dto';
import { AggregatorIntelligenceService } from './aggregator-intelligence.service';

@Controller('aggregator/intelligence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
export class AggregatorIntelligenceController {
  constructor(private readonly intelligence: AggregatorIntelligenceService) {}

  @Get('overview')
  getOverview(
    @CurrentUser() user: any,
    @Query() query: AggregatorAnalyticsQueryDto,
  ) {
    return this.intelligence.getOverview(
      user.activeGymId ?? user.gymId,
      query.days,
    );
  }

  @Get('providers')
  getProviders(
    @CurrentUser() user: any,
    @Query() query: AggregatorAnalyticsQueryDto,
  ) {
    return this.intelligence.getProviders(
      user.activeGymId ?? user.gymId,
      query.days,
    );
  }

  @Get('trends')
  getTrends(
    @CurrentUser() user: any,
    @Query() query: AggregatorAnalyticsQueryDto,
  ) {
    return this.intelligence.getTrends(
      user.activeGymId ?? user.gymId,
      query.days,
    );
  }
}
