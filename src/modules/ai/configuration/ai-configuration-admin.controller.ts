import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AiConfigurationAdminService, AiManagedConfigurationRequest } from './ai-configuration-admin.service';

@Controller('admin/ai/configuration-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AiConfigurationAdminController {
  constructor(private readonly admin: AiConfigurationAdminService) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() body: AiManagedConfigurationRequest) {
    return this.admin.create(user.id, body);
  }
}
