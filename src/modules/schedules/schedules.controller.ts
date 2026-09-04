import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { BookStudentDto } from './dto/book-student.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  @Post('schedule-slots')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createSlot(@Body() dto: CreateScheduleSlotDto, @CurrentUser() user: any) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId: dto.gymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.schedulesService.createSlot(dto, gymId);
  }

  @Get('schedule-slots')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER')
  findAllSlots(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.schedulesService.findAllSlots(gymId);
  }

  @Post('schedules')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  book(
    @Body() dto: BookStudentDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.schedulesService.book(dto, gymId);
  }

  @Patch('schedules/:id/check-in')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  checkIn(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.schedulesService.checkIn(id, gymId);
  }
}
