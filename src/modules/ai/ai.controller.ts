import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AiMobileAdvisoryService } from './ai-mobile-advisory.service';
import {
  AiChatDto,
  AiContentRecommendationDto,
  AiWorkoutInsightsDto,
} from './dto/ai-mobile-advisory.dto';

@Controller('me/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class AiController {
  constructor(private readonly advisory: AiMobileAdvisoryService) {}

  @Post('workout-insights')
  workoutInsights(@CurrentUser() user: any, @Body() dto: AiWorkoutInsightsDto) {
    return this.advisory.workoutInsights(user, dto);
  }

  @Post('chat')
  chat(@CurrentUser() user: any, @Body() dto: AiChatDto) {
    return this.advisory.chat(user, dto);
  }

  @Post('content-recommendations')
  contentRecommendations(
    @CurrentUser() user: any,
    @Body() dto: AiContentRecommendationDto,
  ) {
    return this.advisory.contentRecommendations(user, dto);
  }
}
