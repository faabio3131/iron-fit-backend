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
  IntegrationBreakGlassApproveDto,
  IntegrationBreakGlassExecuteDto,
  IntegrationBreakGlassRequestDto,
  IntegrationBreakGlassRevokeDto,
} from './dto/integration-break-glass.dto';
import { IntegrationBreakGlassService } from './integration-break-glass.service';

@Controller('admin/integrations/break-glass')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class IntegrationBreakGlassController {
  constructor(private readonly service: IntegrationBreakGlassService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post('requests')
  request(
    @CurrentUser() user: any,
    @Body() dto: IntegrationBreakGlassRequestDto,
  ) {
    return this.service.request(user.id, dto);
  }

  @Post(':id/approve')
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationBreakGlassApproveDto,
  ) {
    return this.service.approve(id, user.id, dto);
  }

  @Post(':id/execute')
  execute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationBreakGlassExecuteDto,
  ) {
    return this.service.execute(id, user.id, dto);
  }

  @Post(':id/revoke')
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: any,
    @Body() dto: IntegrationBreakGlassRevokeDto,
  ) {
    return this.service.revoke(id, user.id, dto);
  }
}
