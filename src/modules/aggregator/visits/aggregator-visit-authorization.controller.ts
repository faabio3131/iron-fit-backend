import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthorizeAggregatorVisitDto } from './dto/authorize-aggregator-visit.dto';
import { AggregatorVisitAuthorizationService } from './aggregator-visit-authorization.service';

@Controller('aggregator/visits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AggregatorVisitAuthorizationController {
  constructor(private readonly visits: AggregatorVisitAuthorizationService) {}

  @Post('authorize')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  authorize(@Body() dto: AuthorizeAggregatorVisitDto, @CurrentUser() user: any) {
    return this.visits.authorize(
      dto,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.visits.findOne(id, user.activeGymId ?? user.gymId);
  }
}
