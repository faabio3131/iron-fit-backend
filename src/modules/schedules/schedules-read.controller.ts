import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';
import { SchedulesReadService } from './schedules-read.service';

@Controller('schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulesReadController {
  constructor(private readonly schedulesReadService: SchedulesReadService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER')
  findAll(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.schedulesReadService.findAllBookings(gymId);
  }
}
