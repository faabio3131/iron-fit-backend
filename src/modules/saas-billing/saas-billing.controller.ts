import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { SaasBillingService } from './saas-billing.service';

const FM_COMMAND_AUTHORITY = {
  billingAuthority: 'FM_COMMAND',
  productCode: 'IRON_FIT_CORE',
  localMutationsEnabled: false,
  providerWebhooksAccepted: false,
  mode: 'COMMAND_CENTRALIZED',
} as const;

@Controller('saas-billing')
@UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
@Roles('SUPER_ADMIN', 'OWNER')
export class SaasBillingController {
  constructor(private readonly service: SaasBillingService) {}

  @Get('authority')
  authority() {
    return FM_COMMAND_AUTHORITY;
  }

  @Get('prices')
  listPrices() {
    return this.service.listPrices();
  }

  @Get('current')
  async current(@CurrentUser() user: any) {
    const legacyProjection = await this.service.getCurrent(
      user?.activeGymId ?? user?.gymId,
    );
    return {
      ...legacyProjection,
      authority: FM_COMMAND_AUTHORITY,
      projection: 'LEGACY_READ_ONLY',
    };
  }
}
