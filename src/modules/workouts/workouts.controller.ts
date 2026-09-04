import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

function resolveGymId(user: any, requestedGymId?: string) {
  return resolveTenantOperationGymId({
    activeGymId: user.activeGymId ?? user.gymId,
    requestedGymId,
    isSuperAdmin: user.isSuperAdmin === true,
  });
}

@Controller('workouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkoutsController {
  constructor(private workoutsService: WorkoutsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  findAll(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    return this.workoutsService.findAll(resolveGymId(user, requestedGymId));
  }

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  create(
    @Body() dto: CreateWorkoutDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.workoutsService.create(
      dto,
      resolveGymId(user, requestedGymId),
      user.id,
    );
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.workoutsService.findOne(id, resolveGymId(user, requestedGymId));
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.workoutsService.updateStatus(
      id,
      status,
      user.id,
      resolveGymId(user, requestedGymId),
    );
  }
}

@Controller('students/:studentId/workouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentWorkoutsController {
  constructor(private workoutsService: WorkoutsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  findAllByStudent(
    @Param('studentId') studentId: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    return this.workoutsService.findAllByStudent(
      studentId,
      resolveGymId(user, requestedGymId),
    );
  }
}
