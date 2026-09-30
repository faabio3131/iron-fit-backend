import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('summary')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getSummary(@CurrentUser() user: any) {
    const includeFinancial = Array.isArray(user?.roles)
      && user.roles.some((role: string) => ['SUPER_ADMIN', 'OWNER'].includes(role));
    return this.dashboardService.getSummary(
      user.activeGymId ?? user.gymId,
      { includeFinancial },
    );
  }

  @Get('revenue')
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
