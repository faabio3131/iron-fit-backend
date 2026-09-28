import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { IntegrationOAuthProviderService } from './integration-oauth-provider.service';

@Controller('integrations/oauth')
export class IntegrationOAuthCallbackController {
  constructor(private readonly providerOAuth: IntegrationOAuthProviderService) {}

  @Get(':providerCode/callback')
  callback(
    @Param('providerCode') providerCode: string,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') providerError?: string,
  ) {
    if (providerError) {
      throw new BadRequestException(
        'Autorizacao OAuth nao concluida pelo provider',
      );
    }
    if (!state || !code) {
      throw new BadRequestException(
        'OAuth callback exige state e authorization code',
      );
    }
    return this.providerOAuth.completeCallback(providerCode, state, code);
  }
}
