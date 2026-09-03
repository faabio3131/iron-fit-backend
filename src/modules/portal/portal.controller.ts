import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PortalService } from './portal.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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

  @Get('assessments')
  assessments(@CurrentUser() user: any) {
    return this.portalService.getAssessments(user.id, user.activeGymId ?? user.gymId);
  }

  @Get('schedules')
  schedules(@CurrentUser() user: any) {
    return this.portalService.getSchedules(user.id, user.activeGymId ?? user.gymId);
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
