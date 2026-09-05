import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AggregatorOperationsQueryDto } from './dto/aggregator-operations-query.dto';
import { AggregatorOperationsService } from './aggregator-operations.service';

@Controller('aggregator/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AggregatorOperationsController {
  constructor(private readonly operations: AggregatorOperationsService) {}

  @Get('summary')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getSummary(@CurrentUser() user: any) {
    return this.operations.getSummary(user.activeGymId ?? user.gymId);
  }

  @Get('reception-queue')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getReceptionQueue(
    @CurrentUser() user: any,
    @Query() query: AggregatorOperationsQueryDto,
  ) {
    return this.operations.getReceptionQueue(
      user.activeGymId ?? user.gymId,
      query.limit,
    );
  }

  @Get('risk-queue')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  getRiskQueue(
    @CurrentUser() user: any,
    @Query() query: AggregatorOperationsQueryDto,
  ) {
    return this.operations.getRiskQueue(
      user.activeGymId ?? user.gymId,
      query.limit,
    );
  }

  @Get('settlement-queue')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  getSettlementQueue(
    @CurrentUser() user: any,
    @Query() query: AggregatorOperationsQueryDto,
  ) {
    return this.operations.getSettlementQueue(
      user.activeGymId ?? user.gymId,
      query.limit,
    );
  }
}
