import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUpService } from '../auth/step-up.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(
    private dashboardService: DashboardService,
    private readonly stepUp: StepUpService,
  ) {}

  @Get('summary')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  async getSummary(@CurrentUser() user: any) {
    const ownerOrAdmin = Array.isArray(user?.roles)
      && user.roles.some((role: string) => ['SUPER_ADMIN', 'OWNER'].includes(role));
    const stepUp = ownerOrAdmin
      ? await this.stepUp.status(user.id, user.sessionId)
      : { active: false };
    return this.dashboardService.getSummary(
      user.activeGymId ?? user.gymId,
      { includeFinancial: ownerOrAdmin && stepUp.active },
    );
  }

  @Get('revenue')
  @UseGuards(StepUpGuard)
  @Roles('SUPER_ADMIN', 'OWNER')
  getRevenue(@CurrentUser() user: any, @Query('days') days: string = '30') {
    return this.dashboardService.getRevenueByDay(user.gymId, parseInt(days, 10) || 30);
  }

  @Get('attendance')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getAttendance(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.dashboardService.getAttendance(user.gymId, parseInt(days, 10) || 7);
  }

  @Get('overdue')
  @UseGuards(StepUpGuard)
  @Roles('SUPER_ADMIN', 'OWNER')
  getOverdue(@CurrentUser() user: any) {
    return this.dashboardService.getOverdueCharges(user.gymId);
  }

  @Get('birthdays')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getBirthdays(@CurrentUser() user: any, @Query('days') days: string = '30') {
    return this.dashboardService.getUpcomingBirthdays(user.gymId, parseInt(days, 10) || 30);
  }
}
