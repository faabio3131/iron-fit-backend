import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';
import { AiMonthlyQuotaService } from './runtime/ai-monthly-quota.service';
import { aiCreditCheckoutReady } from './ai-credit-checkout-readiness';

@Controller('ai/quota')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
export class AiMonthlyQuotaController {
  constructor(private readonly quota: AiMonthlyQuotaService) {}

  @Get()
  async current(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    const [workouts, advisory] = await Promise.all([
      this.quota.usage(gymId, 'WORKOUT_GENERATION'),
      this.quota.usage(gymId, 'ADVISORY_CHAT'),
    ]);
    return {
      workouts, advisory,
      thresholds: { warning: 70, critical: 90, exhausted: 100 },
      rollover: false,
      creditPurchaseStatus: aiCreditCheckoutReady() ? 'AVAILABLE' : 'NOT_CONFIGURED',
    };
  }
}
