import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AccessManufacturer,
  PhysicalDeviceDescriptor,
  PhysicalPassageEvent,
  PhysicalReleaseCommand,
  PhysicalReleaseReceipt,
  PhysicalDeviceUnavailableError,
} from './physical-access-driver';
import { VendorProtocolBridge } from './vendor-bridges';

/**
 * Hardware SDK calls only occur in an explicitly installed, trusted local
 * connector. There are no fabricated Henry, DIMEP or EasyInner DLL symbols.
 * The integrator supplies an official SDK binding implementing these hooks.
 */
export interface CertifiedNativeSdk {
  readonly manufacturer: AccessManufacturer;
  readonly certifiedModels: ReadonlySet<string>;
  readonly certifiedFirmwareVersions: ReadonlySet<string>;
  readonly sdkVersion: string;
  readonly attested: boolean;
  readonly gatewayId: string;
  releaseBySdk(command: {
    authorizationId: string;
    deviceId: string;
    model: string;
    firmware: string;
    direction: 'ENTRY' | 'EXIT';
    expiresAt: string;
  }): Promise<{ accepted: boolean; authorizationId: string; sdkEventId?: string }>;
}

export interface SignedSdkPassage {
  readonly gatewayId: string;
  readonly deviceId: string;
  readonly manufacturer: AccessManufacturer;
  readonly authorizationId: string;
  readonly vendorEventId: string;
  readonly occurredAt: string;
  readonly outcome: string;
  readonly signature: string;
}

/**
 * Bind passage evidence to the authenticated gateway, device, timestamp,
 * event and authorization. Events without this evidence NEVER count as giro.
 * The signing key is installed per gateway, not in Git or tenant-facing UI.
 */
export function sdkPassagePayload(event: Omit<SignedSdkPassage, 'signature'>): string {
  return JSON.stringify([
    event.gatewayId, event.deviceId, event.manufacturer,
    event.authorizationId, event.vendorEventId, event.occurredAt, event.outcome,
  ]);
}

export function signSdkPassage(event: Omit<SignedSdkPassage, 'signature'>, signingKey: Buffer): string {
  if (signingKey.byteLength < 32) throw new Error('Chave de gateway insuficiente');
  return createHmac('sha256', signingKey).update(sdkPassagePayload(event)).digest('hex');
}

export function verifySdkPassage(event: SignedSdkPassage, signingKey: Buffer): boolean {
  if (signingKey.byteLength < 32 || !/^[0-9a-f]{64}$/i.test(event.signature)) return false;
  const expected = Buffer.from(signSdkPassage(event, signingKey), 'hex');
  const provided = Buffer.from(event.signature, 'hex');
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

export class NativeSdkVendorBridge implements VendorProtocolBridge {
  readonly manufacturer: AccessManufacturer;
  private readonly usedEventIds = new Set<string>();

  constructor(
    manufacturer: 'TOPDATA' | 'HENRY' | 'DIMEP',
    private readonly sdk: CertifiedNativeSdk,
    private readonly signingKey: Buffer,
    private readonly receiveEvidence: (event: PhysicalPassageEvent) => Promise<SignedSdkPassage | null>,
  ) {
    if (sdk.manufacturer !== manufacturer || !sdk.gatewayId || !sdk.sdkVersion || !sdk.attested || signingKey.byteLength < 32) {
      throw new PhysicalDeviceUnavailableError(manufacturer, 'SDK local nao atestado');
    }
    this.manufacturer = manufacturer;
  }

  supportsModel(model: string, firmware?: string): boolean {
    return this.sdk.attested &&
      !!firmware &&
      this.sdk.certifiedModels.has(model) &&
      this.sdk.certifiedFirmwareVersions.has(firmware);
  }

  async open(device: PhysicalDeviceDescriptor, command: PhysicalReleaseCommand): Promise<PhysicalReleaseReceipt> {
    if (device.manufacturer !== this.manufacturer || !this.supportsModel(device.model, device.protocolVersion)) {
      throw new PhysicalDeviceUnavailableError(this.manufacturer, 'modelo/firmware nao certificado');
    }
    if (command.deviceId !== device.deviceId || command.expiresAt <= new Date()) {
      throw new PhysicalDeviceUnavailableError(this.manufacturer, 'comando expirado ou divergente');
    }
    const result = await this.sdk.releaseBySdk({
      authorizationId: command.authorizationId,
      deviceId: command.deviceId,
      model: device.model,
      firmware: device.protocolVersion!,
      direction: command.direction,
      expiresAt: command.expiresAt.toISOString(),
    });
    if (!result?.accepted || result.authorizationId !== command.authorizationId) {
      throw new PhysicalDeviceUnavailableError(this.manufacturer, 'SDK nao confirmou comando');
    }
    return {
      authorizationId: command.authorizationId,
      accepted: true,
      vendorEventId: result.sdkEventId,
    };
  }

  async authenticatePassage(device: PhysicalDeviceDescriptor, event: PhysicalPassageEvent): Promise<boolean> {
    if (!this.supportsModel(device.model, device.protocolVersion) ||
        event.deviceId !== device.deviceId ||
        event.outcome !== 'CONFIRMED' ||
        !event.vendorEventId || !event.authorizationId ||
        !Number.isFinite(event.occurredAt.getTime())) return false;

    const evidence = await this.receiveEvidence(event);
    if (!evidence || evidence.gatewayId !== this.sdk.gatewayId ||
        evidence.deviceId !== device.deviceId ||
        evidence.manufacturer !== this.manufacturer ||
        evidence.authorizationId !== event.authorizationId ||
        evidence.vendorEventId !== event.vendorEventId ||
        evidence.occurredAt !== event.occurredAt.toISOString() ||
        evidence.outcome !== 'CONFIRMED' ||
        !verifySdkPassage(evidence, this.signingKey)) return false;

    // This is only an in-process guard. Database uniqueness supplies durable
    // cross-worker replay protection in PhysicalAccessAttempt.
    const replayKey = device.deviceId + ':' + event.vendorEventId;
    if (this.usedEventIds.has(replayKey)) return false;
    this.usedEventIds.add(replayKey);
    return true;
  }
}

export class TopdataEasyInnerBridge extends NativeSdkVendorBridge {
  constructor(sdk: CertifiedNativeSdk, key: Buffer, evidence: (event: PhysicalPassageEvent) => Promise<SignedSdkPassage | null>) {
    super('TOPDATA', sdk, key, evidence);
  }
}

export class HenrySdkBridge extends NativeSdkVendorBridge {
  constructor(sdk: CertifiedNativeSdk, key: Buffer, evidence: (event: PhysicalPassageEvent) => Promise<SignedSdkPassage | null>) {
    super('HENRY', sdk, key, evidence);
  }
}

export class DimepSdkBridge extends NativeSdkVendorBridge {
  constructor(sdk: CertifiedNativeSdk, key: Buffer, evidence: (event: PhysicalPassageEvent) => Promise<SignedSdkPassage | null>) {
    super('DIMEP', sdk, key, evidence);
  }
}
