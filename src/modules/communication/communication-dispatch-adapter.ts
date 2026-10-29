import { Injectable } from '@nestjs/common';
import { IntegrationSecretValue } from '../integrations/secrets/integration-secret-vault.port';

const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const DISPATCH_TIMEOUT_MS = 20_000;

export class CommunicationDispatchFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CommunicationDispatchFailure';
  }
}

export interface ExternalCommunicationDispatchInput {
  dispatchKey: string;
  recipient: string;
  title: string | null;
  body: string;
  publicConfiguration: unknown;
  credential: IntegrationSecretValue;
}

export interface ExternalCommunicationDispatchResult {
  providerMessageRef: string | null;
}

export interface ExternalCommunicationAdapter {
  readonly providerCode: string;
  readonly channel: string;
  dispatch(
    input: ExternalCommunicationDispatchInput,
  ): Promise<ExternalCommunicationDispatchResult>;
}

function httpsEndpoint(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new CommunicationDispatchFailure('PROVIDER_ENDPOINT_MISSING');
  }
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:') {
      throw new Error('protocol');
    }
    return parsed.toString();
  } catch {
    throw new CommunicationDispatchFailure('PROVIDER_ENDPOINT_INVALID');
  }
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) {
    throw new CommunicationDispatchFailure('RECIPIENT_PHONE_INVALID');
  }
  return digits;
}

function configuration(raw: unknown): {
  whatsappMessagesEndpoint: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CommunicationDispatchFailure('PROVIDER_CONFIG_MISSING');
  }
  const value = raw as Record<string, unknown>;
  return {
    whatsappMessagesEndpoint: httpsEndpoint(
      value.whatsappMessagesEndpoint,
    ),
  };
}

function evolutionConfiguration(raw: unknown): {
  baseUrl: string;
  instanceName: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CommunicationDispatchFailure('PROVIDER_CONFIG_MISSING');
  }
  const value = raw as Record<string, unknown>;
  const baseUrl = httpsEndpoint(value.baseUrl);
  const instanceName = value.instanceName;
  if (
    typeof instanceName !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(instanceName)
  ) {
    throw new CommunicationDispatchFailure('EVOLUTION_INSTANCE_INVALID');
  }
  return { baseUrl, instanceName };
}

@Injectable()
export class MetaWhatsAppCommunicationAdapter
  implements ExternalCommunicationAdapter
{
  readonly providerCode = 'meta';
  readonly channel = 'WHATSAPP';

  async dispatch(
    input: ExternalCommunicationDispatchInput,
  ): Promise<ExternalCommunicationDispatchResult> {
    const cfg = configuration(input.publicConfiguration);
    const recipient = normalizePhone(input.recipient);
    const body = input.body.trim();
    if (!body || body.length > 4096) {
      throw new CommunicationDispatchFailure('MESSAGE_BODY_INVALID');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
    try {
      const response = await fetch(cfg.whatsappMessagesEndpoint, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + input.credential.reveal(),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'text',
          text: { body },
        }),
        redirect: 'error',
        signal: controller.signal,
      });

      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new CommunicationDispatchFailure(
          'PROVIDER_RESPONSE_TOO_LARGE',
        );
      }

      let payload: Record<string, unknown> = {};
      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('shape');
          }
          payload = parsed as Record<string, unknown>;
        } catch {
          throw new CommunicationDispatchFailure(
            'PROVIDER_RESPONSE_INVALID',
          );
        }
      }

      if (!response.ok) {
        throw new CommunicationDispatchFailure(
          'PROVIDER_HTTP_' + response.status,
        );
      }

      const messages = Array.isArray(payload.messages)
        ? payload.messages
        : [];
      const first =
        messages[0] && typeof messages[0] === 'object'
          ? (messages[0] as Record<string, unknown>)
          : null;
      const providerMessageRef =
        first &&
        typeof first.id === 'string' &&
        first.id.trim() &&
        first.id.length <= 512
          ? first.id.trim()
          : null;

      return { providerMessageRef };
    } catch (error) {
      if (error instanceof CommunicationDispatchFailure) throw error;
      throw new CommunicationDispatchFailure(
        'PROVIDER_UNAVAILABLE_OR_TIMEOUT',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

@Injectable()
export class EvolutionWhatsAppCommunicationAdapter
  implements ExternalCommunicationAdapter
{
  readonly providerCode = 'evolution';
  readonly channel = 'WHATSAPP';

  async dispatch(
    input: ExternalCommunicationDispatchInput,
  ): Promise<ExternalCommunicationDispatchResult> {
    const cfg = evolutionConfiguration(input.publicConfiguration);
    const recipient = normalizePhone(input.recipient);
    const body = input.body.trim();
    if (!body || body.length > 4000) {
      throw new CommunicationDispatchFailure('MESSAGE_BODY_INVALID');
    }
    const endpoint = new URL(
      'message/sendText/' + encodeURIComponent(cfg.instanceName),
      cfg.baseUrl.endsWith('/') ? cfg.baseUrl : cfg.baseUrl + '/',
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: input.credential.reveal(),
          'content-type': 'application/json',
          accept: 'application/json',
          'x-idempotency-key': input.dispatchKey,
        },
        body: JSON.stringify({ number: recipient, text: body }),
        redirect: 'error',
        signal: controller.signal,
      });
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new CommunicationDispatchFailure('PROVIDER_RESPONSE_TOO_LARGE');
      }
      let payload: Record<string, unknown> = {};
      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('shape');
          }
          payload = parsed as Record<string, unknown>;
        } catch {
          throw new CommunicationDispatchFailure('PROVIDER_RESPONSE_INVALID');
        }
      }
      if (!response.ok) {
        throw new CommunicationDispatchFailure('PROVIDER_HTTP_' + response.status);
      }
      const key =
        payload.key && typeof payload.key === 'object' && !Array.isArray(payload.key)
          ? (payload.key as Record<string, unknown>)
          : null;
      const providerMessageRef =
        key && typeof key.id === 'string' && key.id.trim() && key.id.length <= 200
          ? key.id.trim()
          : null;
      if (!providerMessageRef) {
        throw new CommunicationDispatchFailure('PROVIDER_MESSAGE_ID_MISSING');
      }
      return { providerMessageRef };
    } catch (error) {
      if (error instanceof CommunicationDispatchFailure) throw error;
      throw new CommunicationDispatchFailure('PROVIDER_UNAVAILABLE_OR_TIMEOUT');
    } finally {
      clearTimeout(timeout);
    }
  }
}

@Injectable()
export class ExternalCommunicationAdapterRegistry {
  private readonly adapters: ReadonlyMap<
    string,
    ExternalCommunicationAdapter
  >;

  constructor(
    metaWhatsApp: MetaWhatsAppCommunicationAdapter,
    evolutionWhatsApp: EvolutionWhatsAppCommunicationAdapter,
  ) {
    this.adapters = new Map<string, ExternalCommunicationAdapter>([
      [
        this.key(metaWhatsApp.providerCode, metaWhatsApp.channel),
        metaWhatsApp,
      ],
      [
        this.key(evolutionWhatsApp.providerCode, evolutionWhatsApp.channel),
        evolutionWhatsApp,
      ],
    ]);
  }

  private key(providerCode: string, channel: string): string {
    return (
      providerCode.trim().toLowerCase() +
      ':' +
      channel.trim().toUpperCase()
    );
  }

  require(
    providerCode: string,
    channel: string,
  ): ExternalCommunicationAdapter {
    const adapter = this.adapters.get(this.key(providerCode, channel));
    if (!adapter) {
      throw new CommunicationDispatchFailure(
        'COMMUNICATION_ADAPTER_NOT_IMPLEMENTED',
      );
    }
    return adapter;
  }
}
