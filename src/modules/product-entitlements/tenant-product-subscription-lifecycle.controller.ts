import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TransitionTenantProductSubscriptionDto } from './dto/transition-tenant-product-subscription.dto';
import { TenantProductSubscriptionLifecycleService } from './tenant-product-subscription-lifecycle.service';

@Controller('product-entitlements/tenant-subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantProductSubscriptionLifecycleController {
  constructor(
    private readonly lifecycle: TenantProductSubscriptionLifecycleService,
  ) {}

  @Post('transition')
  @Roles('SUPER_ADMIN')
  transition(
    @Body() dto: TransitionTenantProductSubscriptionDto,
    @CurrentUser() user: any,
  ) {
    return this.lifecycle.transition(dto, user?.id);
  }
}
