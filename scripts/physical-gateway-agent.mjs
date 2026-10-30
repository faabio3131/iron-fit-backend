#!/usr/bin/env node
/**
 * IRON on-premise physical gateway.
 *
 * This is a real HTTPS reverse-poll client, not a hardware simulator.
 * A vendor binding implementing the SDK contract must be installed locally.
 * Never install vendor binaries or credentials in the cloud backend.
 *
 * Environment:
 * IRON_GATEWAY_URL=https://<backend origin> (no query or userinfo)
 * IRON_GATEWAY_DEVICE_ID=<provisioned UUID>
 * IRON_GATEWAY_DEVICE_TOKEN=<one-time device secret>
 * IRON_GATEWAY_SDK_BINDING=file:///C:/iron-gateway/official-sdk-binding.mjs
 *
 * The binding module exports createIronSdkBinding(), which returns:
 * { manufacturer, model, firmware,
 *   readIdentification(): Promise<{qrToken,direction}|null>,
 *   release(command): Promise<{accepted:boolean,authorizationId:string}>,
 *   waitForPassage(command): Promise<{vendorEventId:string,occurredAt:string,outcome:'CONFIRMED'|'NOT_CONFIRMED'}|null>
 * }.
 *
 * Vendor-specific DLL signatures and protocol bytes are never guessed here.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API_PATH = '/access/hardware/';
const SUPPORTED = new Set(['TOPDATA', 'HENRY', 'DIMEP']);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function gatewayOrigin(raw) {
  const value = new URL(raw);
  if (value.protocol !== 'https:' || value.username || value.password ||
      value.search || value.hash || value.pathname !== '/') {
    throw new Error('A origem do gateway deve ser HTTPS sem credenciais na URL');
  }
  return value.origin;
}

export function passageSignature(input, token) {
  return createHmac('sha256', token).update(JSON.stringify([
    input.deviceId, input.gymId, input.manufacturer, input.authorizationId,
    input.vendorEventId, input.occurredAt, input.outcome,
  ])).digest('hex');
}

export class IronPhysicalGatewayClient {
  constructor({ origin, deviceId, token, sdk, fetchImpl = fetch }) {
    this.origin = gatewayOrigin(origin);
    if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !token || token.length < 32) {
      throw new Error('Identidade de equipamento incompleta');
    }
    if (!SUPPORTED.has(sdk?.manufacturer) || !sdk.model || !sdk.firmware ||
        typeof sdk.readIdentification !== 'function' ||
        typeof sdk.release !== 'function' ||
        typeof sdk.waitForPassage !== 'function') {
      throw new Error('SDK local nao carregado ou nao compativel');
    }
    this.deviceId = deviceId;
    this.token = token;
    this.sdk = sdk;
    this.fetch = fetchImpl;
  }

  async call(operation, body = {}) {
    if (!['identify', 'claim', 'ack', 'passage'].includes(operation)) {
      throw new Error('Operacao de gateway desconhecida');
    }
    const response = await this.fetch(this.origin + API_PATH + operation, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        deviceId: this.deviceId,
        deviceToken: this.token,
        nonce: randomBytes(24).toString('hex'),
        timestamp: Date.now(),
        ...body,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Gateway HTTP '+response.status);
    return response.json();
  }

  /** One identity -> canonical decision -> reserved command -> SDK ACK -> physical giro. */
  async processOnce() {
    const identity = await this.sdk.readIdentification();
    if (!identity) return { handled: false };
    if (typeof identity.qrToken !== 'string' || !['ENTRY', 'EXIT'].includes(identity.direction)) {
      return { handled: true, allowed: false };
    }

    const decision = await this.call('identify', {
      qrToken: identity.qrToken,
      direction: identity.direction,
    });
    if (!decision.allowed || !decision.authorizationId) {
      return { handled: true, allowed: false };
    }

    const { command } = await this.call('claim');
    if (!command || command.authorizationId !== decision.authorizationId ||
        command.deviceId !== this.deviceId || command.manufacturer !== this.sdk.manufacturer ||
        Date.parse(command.expiresAt) <= Date.now()) {
      // Never guess a command, and never retry an uncertain authorization.
      return { handled: true, allowed: false };
    }

    let ack = { accepted: false, authorizationId: command.authorizationId };
    try {
      const result = await this.sdk.release(command);
      ack = { accepted: result?.accepted === true && result.authorizationId === command.authorizationId,
        authorizationId: command.authorizationId };
    } catch {
      // Command may have reached the hardware despite local transport failure.
      // Mark UNKNOWN and do not repeat physical release.
      await this.call('ack', { authorizationId: command.authorizationId, status: 'UNKNOWN' });
      return { handled: true, allowed: false, uncertain: true };
    }

    const recordedAck = await this.call('ack', {
      authorizationId: command.authorizationId,
      status: ack.accepted ? 'ACCEPTED' : 'REJECTED',
    });
    if (!ack.accepted || recordedAck.accepted !== true) {
      return { handled: true, allowed: false, uncertain: true };
    }

    const passage = await this.sdk.waitForPassage(command);
    if (!passage) return { handled: true, allowed: true, confirmed: false };
    if (!['CONFIRMED', 'NOT_CONFIRMED'].includes(passage.outcome) ||
        typeof passage.vendorEventId !== 'string' || !passage.vendorEventId ||
        !Number.isFinite(Date.parse(passage.occurredAt))) {
      return { handled: true, allowed: true, confirmed: false };
    }
    const details = {
      deviceId: this.deviceId,
      gymId: decision.gymId,
      manufacturer: this.sdk.manufacturer,
      authorizationId: command.authorizationId,
      vendorEventId: passage.vendorEventId,
      occurredAt: new Date(passage.occurredAt).toISOString(),
      outcome: passage.outcome,
    };
    // Do not accept a tenant ID from the SDK. The backend returns a bound
    // device/academy identity, not a user-provided assertion.
    if (!details.gymId) return { handled: true, allowed: true, confirmed: false };
    const result = await this.call('passage', {
      authorizationId: details.authorizationId,
      vendorEventId: details.vendorEventId,
      occurredAt: details.occurredAt,
      outcome: details.outcome,
      signature: passageSignature(details, this.token),
    });
    return { handled: true, allowed: true, confirmed: result.confirmed === true };
  }
}

async function main() {
  const origin = process.env.IRON_GATEWAY_URL;
  const deviceId = process.env.IRON_GATEWAY_DEVICE_ID;
  const token = process.env.IRON_GATEWAY_DEVICE_TOKEN;
  const binding = process.env.IRON_GATEWAY_SDK_BINDING;
  if (!origin || !deviceId || !token || !binding) {
    throw new Error('Configuracao de gateway ou SDK incompleta');
  }
  const mod = await import(binding);
  if (typeof mod.createIronSdkBinding !== 'function') {
    throw new Error('Modulo SDK nao fornece contrato de integracao IRON');
  }
  const sdk = await mod.createIronSdkBinding();
  const client = new IronPhysicalGatewayClient({ origin, deviceId, token, sdk });
  process.stdout.write('IRON physical gateway iniciado; aguarda SDK e identidade do equipamento.\n');
  while (true) {
    try {
      await client.processOnce();
    } catch {
      // Errors intentionally omit device token, QR value, URLs with secrets
      // and full vendor payloads. Fail closed; no command replay.
      process.stderr.write('Falha de comunicacao com IRON; acesso nao liberado.\n');
      await sleep(2500);
    }
    await sleep(250);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Gateway nao iniciado: configuracao/SDK indisponivel.\n');
    process.exitCode = 1;
  });
}
