import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { BookStudentDto } from './dto/book-student.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  @Post('schedule-slots')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createSlot(@Body() dto: CreateScheduleSlotDto, @CurrentUser() user: any) {
    return this.schedulesService.createSlot(dto, user.gymId);
  }

  @Get('schedule-slots')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER')
  findAllSlots(@CurrentUser() user: any) {
    return this.schedulesService.findAllSlots(user.gymId);
  }

  @Post('schedules')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  book(@Body() dto: BookStudentDto, @CurrentUser() user: any) {
    return this.schedulesService.book(dto, user.gymId);
  }

  @Patch('schedules/:id/check-in')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  checkIn(@Param('id') id: string, @CurrentUser() user: any) {
    return this.schedulesService.checkIn(id, user.gymId);
  }
}
