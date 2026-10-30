import { Controller, Headers, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { StripePaymentWebhookInboxService } from './stripe-payment-webhook-inbox.service';

@Controller('financial/provider-webhooks/stripe')
export class StripePaymentWebhookController {
  constructor(private readonly inbox: StripePaymentWebhookInboxService) {}

  // No JWT on a provider callback. Exact-byte HMAC with TENANT Vault signing
  // secret is the mandatory authentication gate; event is notification-only.
  @Post(':connectionId')
  receive(
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Headers('stripe-signature') signature: string,
    @Req() request: { rawBody?: Buffer },
  ) {
    return this.inbox.ingest(connectionId, signature, request.rawBody);
  }
}
