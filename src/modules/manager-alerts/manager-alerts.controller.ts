import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ManagerAlertQueryDto } from './dto/manager-alert-query.dto';
import { ManagerAlertsService } from './manager-alerts.service';
import { UpdateManagerAlertPreferenceDto } from './dto/update-manager-alert-preference.dto';
import { UpdateManagerAlertPolicyDto } from './dto/update-manager-alert-policy.dto';
import { StepUpGuard } from '../auth/guards/step-up.guard';

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

  @Get('preferences')
  preferences(@CurrentUser() user: any) {
    return this.alerts.preferences(user);
  }

  @Put('preferences/:category')
  updatePreference(
    @Param('category') category: string,
    @Body() dto: UpdateManagerAlertPreferenceDto,
    @CurrentUser() user: any,
  ) {
    return this.alerts.updatePreference(category, dto, user);
  }

  @Get('policies')
  policies(@CurrentUser() user: any) {
    return this.alerts.policies(user);
  }

  @Put('policies/:category')
  @UseGuards(StepUpGuard)
  @Roles('OWNER')
  updatePolicy(
    @Param('category') category: string,
    @Body() dto: UpdateManagerAlertPolicyDto,
    @CurrentUser() user: any,
  ) {
    return this.alerts.updatePolicy(category, dto, user);
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
