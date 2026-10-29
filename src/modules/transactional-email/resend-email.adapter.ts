import { Injectable, OnModuleInit } from '@nestjs/common';
import { TransactionalEmailProviderAdapterRegistry, TransactionalEmailDispatchFailure, TransactionalEmailDispatchInput, TransactionalEmailDispatchResult } from './transactional-email-provider-adapter';

@Injectable()
export class ResendEmailAdapter implements OnModuleInit {
  readonly providerCode = 'resend';
  constructor(private readonly registry: TransactionalEmailProviderAdapterRegistry) {}
  onModuleInit() { this.registry.register(this); }

  async dispatch(input: TransactionalEmailDispatchInput): Promise<TransactionalEmailDispatchResult> {
    const config = input.publicConfiguration;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TransactionalEmailDispatchFailure('EMAIL_CONFIGURATION_INVALID');
    const from = (config as Record<string, unknown>).from;
    if (typeof from !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) || from.length > 320)
      throw new TransactionalEmailDispatchFailure('EMAIL_SENDER_INVALID');
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(input.dispatchKey))
      throw new TransactionalEmailDispatchFailure('EMAIL_IDEMPOTENCY_INVALID');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          authorization: 'Bearer ' + input.credential.reveal(),
          'content-type': 'application/json',
          'Idempotency-Key': input.dispatchKey,
        },
        body: JSON.stringify({ from, to: [input.recipient], subject: input.subject, text: input.textBody, html: input.htmlBody }),
      });
      if (!response.ok) throw new TransactionalEmailDispatchFailure('EMAIL_PROVIDER_HTTP_' + response.status);
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 65536) throw new TransactionalEmailDispatchFailure('EMAIL_PROVIDER_RESPONSE_TOO_LARGE');
      let result: unknown;
      try { result = JSON.parse(raw); } catch { throw new TransactionalEmailDispatchFailure('EMAIL_PROVIDER_RESPONSE_INVALID'); }
      const id = (result as { id?: unknown })?.id;
      if (typeof id !== 'string' || !id || id.length > 512) throw new TransactionalEmailDispatchFailure('EMAIL_PROVIDER_RESPONSE_INVALID');
      return { providerMessageRef: id };
    } catch (error) {
      if (error instanceof TransactionalEmailDispatchFailure) throw error;
      throw new TransactionalEmailDispatchFailure('EMAIL_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
}
