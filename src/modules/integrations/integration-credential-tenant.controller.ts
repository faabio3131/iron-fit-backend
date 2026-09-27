import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateIntegrationCredentialDto,
  RevokeIntegrationCredentialDto,
  RotateIntegrationCredentialDto,
  VerifyIntegrationCredentialDto,
} from './dto/integration-credential-admin.dto';
import { IntegrationCredentialAdminService } from './integration-credential-admin.service';

function tenantScope(user: any) {
  const gymId = user?.activeGymId ?? user?.gymId;
  if (!gymId) throw new Error('Tenant ativo obrigatorio para administrar integracoes');
  return { scope: 'TENANT' as const, gymId };
}

@Controller('integrations/connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class IntegrationCredentialTenantController {
  constructor(private readonly service: IntegrationCredentialAdminService) {}

  @Get()
  list(@CurrentUser() user: any) {
    return this.service.list(tenantScope(user));
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateIntegrationCredentialDto) {
    return this.service.create(tenantScope(user), user.id, dto);
  }

  @Post(':id/rotate')
  rotate(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RotateIntegrationCredentialDto,
  ) {
    return this.service.rotate(tenantScope(user), id, user.id, dto);
  }

  @Post(':id/verify')
  verify(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyIntegrationCredentialDto,
  ) {
    return this.service.verify(tenantScope(user), id, user.id, dto);
  }

  @Post(':id/revoke')
  revoke(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeIntegrationCredentialDto,
  ) {
    return this.service.revoke(tenantScope(user), id, user.id, dto);
  }
}
