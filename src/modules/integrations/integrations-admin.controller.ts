import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateIntegrationConnectionDto,
  PutIntegrationSecretDto,
  RevokeIntegrationSecretDto,
  UpdateIntegrationConfigurationDto,
  VerifyIntegrationSecretDto,
} from './dto/integrations-admin.dto';
import { IntegrationsAdminService } from './integrations-admin.service';

@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegrationsAdminController {
  constructor(private readonly integrations: IntegrationsAdminService) {}

  @Get('providers')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  providers() {
    return this.integrations.providers();
  }

  @Get('tenant/connections')
  @Roles('OWNER', 'MANAGER')
  tenantConnections(@CurrentUser() user: any) {
    return this.integrations.listTenant(user.activeGymId ?? user.gymId);
  }

  @Post('tenant/connections')
  @Roles('OWNER')
  createTenant(
    @CurrentUser() user: any,
    @Body() dto: CreateIntegrationConnectionDto,
  ) {
    return this.integrations.createTenant(
      user.activeGymId ?? user.gymId,
      user.id,
      dto,
    );
  }

  @Patch('tenant/connections/:id/configuration')
  @Roles('OWNER')
  updateTenantConfiguration(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateIntegrationConfigurationDto,
  ) {
    return this.integrations.updateTenantConfiguration(
      id,
      user.activeGymId ?? user.gymId,
      user.id,
      dto,
    );
  }

  @Put('tenant/connections/:id/secret')
  @Roles('OWNER')
  putTenantSecret(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: PutIntegrationSecretDto,
  ) {
    return this.integrations.putTenantSecret(
      id,
      user.activeGymId ?? user.gymId,
      user.id,
      dto,
    );
  }

  @Post('tenant/connections/:id/secret/verify')
  @Roles('OWNER')
  verifyTenantSecret(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: VerifyIntegrationSecretDto,
  ) {
    return this.integrations.verifyTenantSecret(
      id,
      user.activeGymId ?? user.gymId,
      user.id,
      dto,
    );
  }

  @Delete('tenant/connections/:id/secret')
  @Roles('OWNER')
  revokeTenantSecret(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: RevokeIntegrationSecretDto,
  ) {
    return this.integrations.revokeTenantSecret(
      id,
      user.activeGymId ?? user.gymId,
      user.id,
      dto,
    );
  }

  @Get('global/connections')
  @Roles('SUPER_ADMIN')
  globalConnections() {
    return this.integrations.listGlobal();
  }

  @Post('global/connections')
  @Roles('SUPER_ADMIN')
  createGlobal(
    @CurrentUser() user: any,
    @Body() dto: CreateIntegrationConnectionDto,
  ) {
    return this.integrations.createGlobal(user.id, dto);
  }

  @Patch('global/connections/:id/configuration')
  @Roles('SUPER_ADMIN')
  updateGlobalConfiguration(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateIntegrationConfigurationDto,
  ) {
    return this.integrations.updateGlobalConfiguration(id, user.id, dto);
  }

  @Put('global/connections/:id/secret')
  @Roles('SUPER_ADMIN')
  putGlobalSecret(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: PutIntegrationSecretDto,
  ) {
    return this.integrations.putGlobalSecret(id, user.id, dto);
  }

  @Post('global/connections/:id/secret/verify')
  @Roles('SUPER_ADMIN')
  verifyGlobalSecret(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: VerifyIntegrationSecretDto,
  ) {
    return this.integrations.verifyGlobalSecret(id, user.id, dto);
  }

  @Delete('global/connections/:id/secret')
  @Roles('SUPER_ADMIN')
  revokeGlobalSecret(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: RevokeIntegrationSecretDto,
  ) {
    return this.integrations.revokeGlobalSecret(id, user.id, dto);
  }
}
