import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PermissionsOrRoles } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('summary')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getSummary(@CurrentUser() user: any) {
    const includeFinancial = user.roles?.some((role: string) => ['SUPER_ADMIN', 'OWNER'].includes(role)) || user.permissions?.includes('financial:read');
    return this.dashboardService.getSummary(user.activeGymId ?? user.gymId, includeFinancial === true);
  }

  @Get('revenue')
  @PermissionsOrRoles(['financial:read'], ['SUPER_ADMIN', 'OWNER'])
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  getRevenue(@CurrentUser() user: any, @Query('days') days: string = '30') {
    return this.dashboardService.getRevenueByDay(user.gymId, parseInt(days, 10) || 30);
  }

  @Get('attendance')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getAttendance(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.dashboardService.getAttendance(user.gymId, parseInt(days, 10) || 7);
  }

  @Get('overdue')
  @PermissionsOrRoles(['financial:read'], ['SUPER_ADMIN', 'OWNER'])
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getOverdue(@CurrentUser() user: any) {
    return this.dashboardService.getOverdueCharges(user.gymId);
  }

  @Get('birthdays')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  getBirthdays(@CurrentUser() user: any, @Query('days') days: string = '30') {
    return this.dashboardService.getUpcomingBirthdays(user.gymId, parseInt(days, 10) || 30);
  }
}
