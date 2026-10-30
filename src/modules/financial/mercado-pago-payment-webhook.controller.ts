import { Controller, Headers, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { MercadoPagoPaymentWebhookInboxService } from './mercado-pago-payment-webhook-inbox.service';

@Controller('financial/provider-webhooks/mercado-pago')
export class MercadoPagoPaymentWebhookController {
  constructor(private readonly inbox: MercadoPagoPaymentWebhookInboxService) {}

  // Provider callback authenticated by tenant webhook signing secret via Vault,
  // never by public body claims and never with the merchant payment token.
  @Post(':connectionId')
  receive(
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Headers('x-signature') signature: string,
    @Headers('x-request-id') requestId: string,
    @Query('data.id') dataId: string,
    @Req() request: { rawBody?: Buffer },
  ) {
    return this.inbox.ingest(connectionId, signature, requestId, dataId, request.rawBody);
  }
}
