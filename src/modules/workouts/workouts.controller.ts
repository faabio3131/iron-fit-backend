import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('workouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkoutsController {
  constructor(private workoutsService: WorkoutsService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  create(@Body() dto: CreateWorkoutDto, @CurrentUser() user: any) {
    return this.workoutsService.create(dto, user.gymId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'STUDENT')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.workoutsService.findOne(id, user.gymId);
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: any,
  ) {
    return this.workoutsService.updateStatus(id, status, user.id, user.gymId);
  }
}

@Controller('students/:studentId/workouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentWorkoutsController {
  constructor(private workoutsService: WorkoutsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'STUDENT')
  findAllByStudent(@Param('studentId') studentId: string, @CurrentUser() user: any) {
    return this.workoutsService.findAllByStudent(studentId, user.gymId);
  }
}
