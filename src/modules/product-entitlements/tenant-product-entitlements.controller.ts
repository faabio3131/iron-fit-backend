import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AssignTenantProductSubscriptionDto } from './dto/assign-tenant-product-subscription.dto';
import { SetProductConfigurationValueDto } from './dto/set-product-configuration-value.dto';
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

  @Get('tenant/configurations')
  @Roles('OWNER', 'MANAGER')
  listTenantConfigurations(@CurrentUser() user: any) {
    return this.tenantEntitlements.listTenantConfigurations(
      user.activeGymId ?? user.gymId,
    );
  }

  @Put('tenant/configurations/:featureKey')
  @Roles('OWNER', 'MANAGER')
  setTenantConfiguration(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
    @Body() dto: SetProductConfigurationValueDto,
  ) {
    return this.tenantEntitlements.setTenantConfiguration(
      user.activeGymId ?? user.gymId,
      featureKey,
      dto,
      user?.id,
    );
  }

  @Delete('tenant/configurations/:featureKey')
  @Roles('OWNER', 'MANAGER')
  resetTenantConfiguration(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.tenantEntitlements.resetTenantConfiguration(
      user.activeGymId ?? user.gymId,
      featureKey,
      user?.id,
    );
  }

  @Get('me/features')
  @Roles('STUDENT')
  resolveAllForStudent(@CurrentUser() user: any) {
    return this.tenantEntitlements.resolveAllForUser(
      user.activeGymId ?? user.gymId,
      user?.id,
    );
  }

  @Get('me/features/:featureKey')
  @Roles('STUDENT')
  resolveFeatureForStudent(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.tenantEntitlements.resolveFeatureForUser(
      user.activeGymId ?? user.gymId,
      user?.id,
      featureKey,
    );
  }

  @Get('me/preferences')
  @Roles('STUDENT')
  listStudentPreferences(@CurrentUser() user: any) {
    return this.tenantEntitlements.listUserPreferences(
      user.activeGymId ?? user.gymId,
      user?.id,
    );
  }

  @Put('me/preferences/:featureKey')
  @Roles('STUDENT')
  setStudentPreference(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
    @Body() dto: SetProductConfigurationValueDto,
  ) {
    return this.tenantEntitlements.setUserPreference(
      user.activeGymId ?? user.gymId,
      user?.id,
      featureKey,
      dto,
    );
  }

  @Delete('me/preferences/:featureKey')
  @Roles('STUDENT')
  resetStudentPreference(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.tenantEntitlements.resetUserPreference(
      user.activeGymId ?? user.gymId,
      user?.id,
      featureKey,
    );
  }
}
