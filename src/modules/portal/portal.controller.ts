import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PortalService } from './portal.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class PortalController {
  constructor(private portalService: PortalService) {}

  @Get('profile')
  profile(@CurrentUser() user: any) {
    return this.portalService.getProfile(user.id);
  }

  @Get('workouts')
  workouts(@CurrentUser() user: any) {
    return this.portalService.getWorkouts(user.id);
  }

  @Get('assessments')
  assessments(@CurrentUser() user: any) {
    return this.portalService.getAssessments(user.id);
  }

  @Get('schedules')
  schedules(@CurrentUser() user: any) {
    return this.portalService.getSchedules(user.id);
  }

  @Get('charges')
  charges(@CurrentUser() user: any) {
    return this.portalService.getCharges(user.id);
  }

  @Post('check-in')
  checkIn(@CurrentUser() user: any) {
    return this.portalService.checkIn(user.id);
  }
}
