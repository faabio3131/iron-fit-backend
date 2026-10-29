import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { EvolutionTenantInstanceService } from './evolution-tenant-instance.service';

@Controller('integrations/evolution')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class EvolutionTenantInstanceController {
  constructor(private readonly evolution: EvolutionTenantInstanceService) {}

  @Get('status')
  status(@CurrentUser() user: any) {
    return this.evolution.status(user);
  }

  @Post('connect')
  @UseGuards(StepUpGuard)
  @Roles('OWNER')
  connect(@CurrentUser() user: any) {
    return this.evolution.connect(user);
  }

  @Delete('connection')
  @UseGuards(StepUpGuard)
  @Roles('OWNER')
  disconnect(@CurrentUser() user: any) {
    return this.evolution.disconnect(user);
  }
}

@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  constructor(private readonly evolution: EvolutionTenantInstanceService) {}

  @Post()
  receive(
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.evolution.handleWebhook(authorization, payload);
  }
}
