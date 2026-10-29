import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ManagerAlertQueryDto } from './dto/manager-alert-query.dto';
import { ManagerAlertsService } from './manager-alerts.service';

@Controller('manager-alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class ManagerAlertsController {
  constructor(private readonly alerts: ManagerAlertsService) {}

  @Get()
  list(@CurrentUser() user: any, @Query() query: ManagerAlertQueryDto) {
    return this.alerts.list(user, query);
  }

  @Get('counters')
  counters(@CurrentUser() user: any) {
    return this.alerts.counters(user);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.alerts.markRead(id, user);
  }

  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string, @CurrentUser() user: any) {
    return this.alerts.transition(id, 'ACKNOWLEDGED', user);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.alerts.transition(id, 'RESOLVED', user);
  }

  @Patch(':id/dismiss')
  dismiss(@Param('id') id: string, @CurrentUser() user: any) {
    return this.alerts.transition(id, 'DISMISSED', user);
  }
}
