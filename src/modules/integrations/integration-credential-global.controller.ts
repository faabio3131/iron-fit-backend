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

const GLOBAL_SCOPE = { scope: 'GLOBAL' as const };

@Controller('admin/integrations/connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class IntegrationCredentialGlobalController {
  constructor(private readonly service: IntegrationCredentialAdminService) {}

  @Get()
  list() {
    return this.service.list(GLOBAL_SCOPE);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateIntegrationCredentialDto) {
    return this.service.create(GLOBAL_SCOPE, user.id, dto);
  }

  @Post(':id/rotate')
  rotate(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RotateIntegrationCredentialDto,
  ) {
    return this.service.rotate(GLOBAL_SCOPE, id, user.id, dto);
  }

  @Post(':id/verify')
  verify(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyIntegrationCredentialDto,
  ) {
    return this.service.verify(GLOBAL_SCOPE, id, user.id, dto);
  }

  @Post(':id/revoke')
  revoke(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeIntegrationCredentialDto,
  ) {
    return this.service.revoke(GLOBAL_SCOPE, id, user.id, dto);
  }
}
