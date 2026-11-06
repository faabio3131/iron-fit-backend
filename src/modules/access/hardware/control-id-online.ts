/**
 * Control iD online (Pro/Enterprise) message adapter.
 * Official event/response format:
 * https://www.controlid.com.br/docs/access-api-pt/modos-de-operacao/eventos-de-identificacao-online/
 *
 * Does NOT authenticate the incoming HTTP request or authorize membership.
 * A trusted connector must bind the hardware to gym/device identity, validate
 * the payload and obtain a canonical AccessService decision FIRST.
 *
 * iDBlock "catra" action applies only to verified compatible firmware/model.
 */
export interface ControlIdOnlineEvent {
  device_id: number;
  uuid: string;
  time: number;
  portal_id: number;
  user_id?: number;
  qrcode_value?: string;
}

export interface ControlIdOnlineResponse {
  result: {
    event: 6 | 7;
    user_id?: number;
    user_image: false;
    portal_id: number;
    actions: Array<{ action: 'catra'; parameters: 'allow=clockwise' | 'allow=anticlockwise' }>;
  };
}

export function parseControlIdQrEvent(input: Record<string, unknown>): ControlIdOnlineEvent {
  const deviceId = Number(input.device_id);
  const portalId = Number(input.portal_id);
  const timestamp = Number(input.time);
  if (!Number.isSafeInteger(deviceId) || deviceId <= 0 ||
      !Number.isSafeInteger(portalId) || portalId <= 0 ||
      !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('Evento Control iD invalido');
  }
  if (typeof input.uuid !== 'string' || input.uuid.length < 16 || input.uuid.length > 128) {
    throw new Error('Identificador do evento invalido');
  }
  if (typeof input.qrcode_value !== 'string' || !/^[a-f0-9]{48}$/i.test(input.qrcode_value)) {
    throw new Error('QR Code incompatível ou inválido');
  }
  return {
    device_id: deviceId, portal_id: portalId, time: timestamp,
    uuid: input.uuid, qrcode_value: input.qrcode_value,
  };
}

export function controlIdOnlineDecision(
  event: ControlIdOnlineEvent,
  allowed: boolean,
  clockwiseIsEntry: boolean,
  direction: 'ENTRY' | 'EXIT',
): ControlIdOnlineResponse {
  if (!Number.isSafeInteger(event.device_id) || event.device_id <= 0 ||
      !Number.isSafeInteger(event.portal_id) || event.portal_id <= 0) {
    throw new Error('Identificacao do equipamento Control iD invalida');
  }
  if (direction !== 'ENTRY' && direction !== 'EXIT') throw new Error('Sentido invalido');
  const side = direction === 'ENTRY'
    ? (clockwiseIsEntry ? 'clockwise' : 'anticlockwise')
    : (clockwiseIsEntry ? 'anticlockwise' : 'clockwise');
  return {
    result: {
      event: allowed ? 7 : 6,
      ...(event.user_id && Number.isSafeInteger(event.user_id) ? { user_id: event.user_id } : {}),
      user_image: false,
      portal_id: event.portal_id,
      actions: allowed ? [{ action: 'catra', parameters: `allow=${side}` as 'allow=clockwise' | 'allow=anticlockwise' }] : [],
    },
  };
}
