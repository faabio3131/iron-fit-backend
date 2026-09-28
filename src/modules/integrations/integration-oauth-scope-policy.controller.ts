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
  CreateOAuthScopePolicyDto,
  ReviewOAuthScopePolicyDto,
} from './dto/integration-oauth-scope-policy.dto';
import { IntegrationOAuthScopePolicyService } from './integration-oauth-scope-policy.service';

@Controller('admin/integrations/oauth-scope-policies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class IntegrationOAuthScopePolicyController {
  constructor(
    private readonly policies: IntegrationOAuthScopePolicyService,
  ) {}

  @Get()
  list() {
    return this.policies.list();
  }

  @Post()
  createDraft(
    @CurrentUser() user: any,
    @Body() dto: CreateOAuthScopePolicyDto,
  ) {
    return this.policies.createDraft(user.id, dto);
  }

  @Post(':id/approve')
  approve(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewOAuthScopePolicyDto,
  ) {
    return this.policies.approve(id, user.id, dto);
  }

  @Post(':id/retire')
  retire(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewOAuthScopePolicyDto,
  ) {
    return this.policies.retire(id, user.id, dto);
  }
}
