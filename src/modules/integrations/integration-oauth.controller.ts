import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StartIntegrationOAuthDto } from './dto/integration-oauth.dto';
import { IntegrationOAuthCoreService } from './integration-oauth-core.service';

@Controller('integrations/oauth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class IntegrationOAuthController {
  constructor(private readonly oauth: IntegrationOAuthCoreService) {}

  @Post(':providerCode/start')
  start(
    @CurrentUser() user: any,
    @Param('providerCode') providerCode: string,
    @Body() dto: StartIntegrationOAuthDto,
  ) {
    const gymId = user?.activeGymId ?? user?.gymId;
    if (!gymId || !user?.id || !user?.sessionId) {
      throw new BadRequestException(
        'Tenant e sessao autenticada obrigatorios para OAuth',
      );
    }
    return this.oauth.startTenantAuthorization(
      {
        userId: user.id,
        sessionId: user.sessionId,
        gymId,
      },
      providerCode,
      dto,
    );
  }
}
