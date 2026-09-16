import { Body, Controller, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';
import { AiWorkoutCandidateService } from './ai-workout-candidate.service';
import { AiWorkoutCandidateRequestDto } from './dto/ai-workout-candidate.dto';

@Controller('ai/workout-candidates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
export class AiWorkoutCandidateController {
  constructor(private readonly candidates: AiWorkoutCandidateService) {}

  @Post()
  generate(
    @CurrentUser() user: any,
    @Body() dto: AiWorkoutCandidateRequestDto,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.candidates.generate(user, gymId, dto);
  }
}
