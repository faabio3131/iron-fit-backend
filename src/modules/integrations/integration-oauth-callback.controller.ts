import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { IntegrationOAuthAuthorizationService } from './integration-oauth-authorization.service';

@Controller('integrations/oauth')
export class IntegrationOAuthCallbackController {
  constructor(
    private readonly authorization: IntegrationOAuthAuthorizationService,
  ) {}

  @Get(':providerCode/callback')
  callback(
    @Param('providerCode') providerCode: string,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') providerError?: string,
  ) {
    if (providerError) {
      throw new BadRequestException('OAuth provider nao autorizou a conexao');
    }
    if (!state || !code) {
      throw new BadRequestException('OAuth callback incompleto');
    }
    return this.authorization.completeCallback(providerCode, state, code);
  }
}
