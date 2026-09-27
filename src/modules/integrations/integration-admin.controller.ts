import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateIntegrationAdminDto,
  IntegrationSecretWriteDto,
  IntegrationStepUpDto,
} from './dto/integration-admin.dto';
import { IntegrationSecretAdminService } from './integration-secret-admin.service';

function tenantActor(user: any) {
  return {
    userId: user.id,
    scope: {
      scope: 'TENANT' as const,
      gymId: user.activeGymId ?? user.gymId,
    },
  };
}

function globalActor(user: any) {
  return {
    userId: user.id,
    scope: { scope: 'GLOBAL' as const },
  };
}

@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class TenantIntegrationAdminController {
  constructor(private readonly service: IntegrationSecretAdminService) {}

  @Get('connections')
  list(@CurrentUser() user: any) {
    return this.service.list(tenantActor(user));
  }

  @Post('connections')
  create(@CurrentUser() user: any, @Body() dto: CreateIntegrationAdminDto) {
    return this.service.create(tenantActor(user), dto);
  }

  @Post('connections/:id/secret/replace')
  replace(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationSecretWriteDto,
  ) {
    return this.service.replace(id, tenantActor(user), dto);
  }

  @Post('connections/:id/secret/rotate')
  rotate(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationSecretWriteDto,
  ) {
    return this.service.rotate(id, tenantActor(user), dto);
  }

  @Post('connections/:id/test')
  test(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationStepUpDto,
  ) {
    return this.service.test(id, tenantActor(user), dto);
  }

  @Post('connections/:id/revoke')
  revoke(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationStepUpDto,
  ) {
    return this.service.revoke(id, tenantActor(user), dto);
  }
}

@Controller('integrations/global')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class GlobalIntegrationAdminController {
  constructor(private readonly service: IntegrationSecretAdminService) {}

  @Get('connections')
  list(@CurrentUser() user: any) {
    return this.service.list(globalActor(user));
  }

  @Post('connections')
  create(@CurrentUser() user: any, @Body() dto: CreateIntegrationAdminDto) {
    return this.service.create(globalActor(user), dto);
  }

  @Post('connections/:id/secret/replace')
  replace(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationSecretWriteDto,
  ) {
    return this.service.replace(id, globalActor(user), dto);
  }

  @Post('connections/:id/secret/rotate')
  rotate(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationSecretWriteDto,
  ) {
    return this.service.rotate(id, globalActor(user), dto);
  }

  @Post('connections/:id/test')
  test(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationStepUpDto,
  ) {
    return this.service.test(id, globalActor(user), dto);
  }

  @Post('connections/:id/revoke')
  revoke(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationStepUpDto,
  ) {
    return this.service.revoke(id, globalActor(user), dto);
  }
}
