import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PortalService } from './portal.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateMyCommunicationPreferencesDto } from './dto/update-my-communication-preferences.dto';
import { CompleteWorkoutSessionDto } from './dto/complete-workout-session.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class PortalController {
  constructor(private portalService: PortalService) {}

  @Get('profile')
  profile(@CurrentUser() user: any) {
    return this.portalService.getProfile(user.id, user.activeGymId ?? user.gymId);
  }

  @Get('workouts')
  workouts(@CurrentUser() user: any) {
    return this.portalService.getWorkouts(user.id, user.activeGymId ?? user.gymId);
  }

  @Get('workout-executions')
  workoutExecutions(@CurrentUser() user: any) {
    return this.portalService.getWorkoutExecutions(user.id, user.activeGymId ?? user.gymId);
  }

  @Post('workouts/:workoutId/sessions/:sessionId/completions')
  completeWorkoutSession(
    @CurrentUser() user: any,
    @Param('workoutId') workoutId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CompleteWorkoutSessionDto,
  ) {
    return this.portalService.completeWorkoutSession(
      user.id, user.activeGymId ?? user.gymId, workoutId, sessionId, dto.requestId,
    );
  }

  @Get('assessments')
  assessments(@CurrentUser() user: any) {
    return this.portalService.getAssessments(user.id, user.activeGymId ?? user.gymId);
  }

  @Get('schedules')
  schedules(@CurrentUser() user: any) {
    return this.portalService.getSchedules(user.id, user.activeGymId ?? user.gymId);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: any) {
    return this.portalService.getCommunicationPreferences(
      user.id,
      user.activeGymId ?? user.gymId,
    );
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: any,
    @Body() dto: UpdateMyCommunicationPreferencesDto,
  ) {
    return this.portalService.updateCommunicationPreferences(
      user.id,
      dto,
      user.activeGymId ?? user.gymId,
    );
  }

  @Get('charges')
  charges(@CurrentUser() user: any) {
    return this.portalService.getCharges(user.id, user.activeGymId ?? user.gymId);
  }

  @Post('check-in')
  checkIn(@CurrentUser() user: any) {
    return this.portalService.checkIn(user.id, user.activeGymId ?? user.gymId);
  }
}
