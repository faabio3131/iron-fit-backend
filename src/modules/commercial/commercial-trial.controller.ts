import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommercialTrialService } from './commercial-trial.service';
import { StartTrialDto } from './dto/start-trial.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';

@Controller('commercial')
export class CommercialTrialController {
  constructor(private readonly service: CommercialTrialService) {}

  @Post('trial/start')
  startTrial(@Req() req: any, @Body() dto: StartTrialDto) {
    return this.service.startTrial(
      dto,
      typeof req?.ip === 'string' ? req.ip : null,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('trial/status')
  trialStatus(@CurrentUser() user: any) {
    return this.service.synchronizeTrial(
      user?.activeGymId ?? user?.gymId,
      user?.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'MANAGER')
  @Get('onboarding')
  onboarding(@CurrentUser() user: any) {
    return this.service.getOnboarding(user?.activeGymId ?? user?.gymId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'MANAGER')
  @Patch('onboarding')
  updateOnboarding(@CurrentUser() user: any, @Body() dto: UpdateOnboardingDto) {
    return this.service.updateOnboarding(
      user?.activeGymId ?? user?.gymId,
      user?.id,
      dto,
    );
  }
}
