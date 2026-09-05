import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SetProductConfigurationDto } from './dto/set-product-configuration.dto';
import { TenantProductConfigurationService } from './tenant-product-configuration.service';

@Controller('product-entitlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantProductConfigurationController {
  constructor(private readonly configuration: TenantProductConfigurationService) {}

  @Get('tenant/effective/features')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER', 'STUDENT')
  resolveTenantAll(@CurrentUser() user: any) {
    return this.configuration.resolveTenantAll(user.activeGymId ?? user.gymId);
  }

  @Get('tenant/effective/features/:featureKey')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER', 'STUDENT')
  resolveTenantFeature(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.configuration.resolveTenantFeature(
      user.activeGymId ?? user.gymId,
      featureKey,
    );
  }

  @Put('tenant/configurations/:featureKey')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  setTenantConfiguration(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
    @Body() dto: SetProductConfigurationDto,
  ) {
    return this.configuration.setTenantConfiguration(
      user.activeGymId ?? user.gymId,
      featureKey,
      dto,
      user?.id,
    );
  }

  @Delete('tenant/configurations/:featureKey')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  deleteTenantConfiguration(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.configuration.deleteTenantConfiguration(
      user.activeGymId ?? user.gymId,
      featureKey,
      user?.id,
    );
  }

  @Get('student/effective/features')
  @Roles('STUDENT')
  resolveStudentAll(@CurrentUser() user: any) {
    return this.configuration.resolveStudentAll(
      user.activeGymId ?? user.gymId,
      user?.id,
    );
  }

  @Get('student/effective/features/:featureKey')
  @Roles('STUDENT')
  resolveStudentFeature(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.configuration.resolveStudentFeature(
      user.activeGymId ?? user.gymId,
      user?.id,
      featureKey,
    );
  }

  @Put('student/preferences/:featureKey')
  @Roles('STUDENT')
  setStudentPreference(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
    @Body() dto: SetProductConfigurationDto,
  ) {
    return this.configuration.setStudentPreference(
      user.activeGymId ?? user.gymId,
      user?.id,
      featureKey,
      dto,
    );
  }

  @Delete('student/preferences/:featureKey')
  @Roles('STUDENT')
  deleteStudentPreference(
    @CurrentUser() user: any,
    @Param('featureKey') featureKey: string,
  ) {
    return this.configuration.deleteStudentPreference(
      user.activeGymId ?? user.gymId,
      user?.id,
      featureKey,
    );
  }
}
