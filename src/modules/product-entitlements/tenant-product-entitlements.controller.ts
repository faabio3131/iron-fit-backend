import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AssignTenantProductSubscriptionDto } from './dto/assign-tenant-product-subscription.dto';
import { TenantProductEntitlementsService } from './tenant-product-entitlements.service';

@Controller('product-entitlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantProductEntitlementsController {
  constructor(private readonly tenantEntitlements: TenantProductEntitlementsService) {}

  @Post('tenant-subscriptions')
  @Roles('SUPER_ADMIN')
  assignInitialSubscription(
    @Body() dto: AssignTenantProductSubscriptionDto,
    @CurrentUser() user: any,
  ) {
    return this.tenantEntitlements.assignInitialSubscription(dto, user?.id);
  }

  @Get('tenant/current')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER', 'STUDENT')
  getCurrentSubscription(@CurrentUser() user: any) {
    return this.tenantEntitlements.getCurrentSubscription(
      user.activeGymId ?? user.gymId,
    );
  }

  @Get('tenant/features')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER', 'STUDENT')
  resolveAll(@CurrentUser() user: any) {
    return this.tenantEntitlements.resolveAll(user.activeGymId ?? user.gymId);
  }

  @Get('tenant/features/:featureKey')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER', 'STUDENT')
  resolveFeature(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.tenantEntitlements.resolveFeature(
      user.activeGymId ?? user.gymId,
      featureKey,
    );
  }
}
