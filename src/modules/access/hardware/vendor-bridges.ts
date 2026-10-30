import {
  AccessManufacturer,
  PhysicalAccessDriver,
  PhysicalDeviceDescriptor,
  PhysicalReleaseCommand,
  PhysicalReleaseReceipt,
  PhysicalPassageEvent,
  PhysicalDeviceUnavailableError,
  assertPhysicalDeviceScope,
  assertFreshPhysicalCommand,
} from './physical-access-driver';

/**
 * Isolate vendor protocol dependencies behind a strictly typed connector.
 * A production connector must be implemented from the model's official SDK/API.
 * Deliberately no synthetic HTTP endpoints or assumed SDK signatures.
 */
export interface VendorProtocolBridge {
  readonly manufacturer: AccessManufacturer;
  supportsModel(model: string, firmware?: string): boolean;
  open(device: PhysicalDeviceDescriptor, command: PhysicalReleaseCommand): Promise<PhysicalReleaseReceipt>;
  authenticatePassage(device: PhysicalDeviceDescriptor, event: PhysicalPassageEvent): Promise<boolean>;
}

export const SUPPORTED_PHYSICAL_MANUFACTURERS: ReadonlyArray<{
  manufacturer: AccessManufacturer;
  transport: PhysicalAccessDriver['transport'];
  credentialModes: readonly string[];
  requiresModelProtocolVerification: boolean;
}> = Object.freeze([
  { manufacturer: 'CONTROL_ID', transport: 'REST', credentialModes: ['QR_CODE', 'CARD', 'BIOMETRIC'], requiresModelProtocolVerification: true },
  { manufacturer: 'TOPDATA', transport: 'LOCAL_SDK', credentialModes: ['QR_CODE', 'CARD', 'BIOMETRIC'], requiresModelProtocolVerification: true },
  { manufacturer: 'HENRY', transport: 'PROPRIETARY', credentialModes: ['CARD', 'BIOMETRIC', 'QR_CODE'], requiresModelProtocolVerification: true },
  { manufacturer: 'DIMEP', transport: 'PROPRIETARY', credentialModes: ['CARD', 'BIOMETRIC', 'QR_CODE'], requiresModelProtocolVerification: true },
]);

export class VendorBridgedPhysicalDriver implements PhysicalAccessDriver {
  readonly manufacturer: AccessManufacturer;
  readonly transport: PhysicalAccessDriver['transport'];

  constructor(
    manufacturer: AccessManufacturer,
    transport: PhysicalAccessDriver['transport'],
    private readonly bridge: VendorProtocolBridge,
  ) {
    if (bridge.manufacturer !== manufacturer) {
      throw new Error('Fornecedor do protocolo nao corresponde ao driver');
    }
    this.manufacturer = manufacturer;
    this.transport = transport;
  }

  supportsDevice(device: PhysicalDeviceDescriptor): boolean {
    return device.manufacturer === this.manufacturer &&
      !!device.model.trim() &&
      this.bridge.supportsModel(device.model, device.protocolVersion);
  }

  async release(device: PhysicalDeviceDescriptor, command: PhysicalReleaseCommand): Promise<PhysicalReleaseReceipt> {
    assertPhysicalDeviceScope(device, command.deviceId, device.gymId);
    if (device.manufacturer !== this.manufacturer) throw new Error('Fabricante do dispositivo divergente');
    assertFreshPhysicalCommand(command);
    if (!this.supportsDevice(device)) throw new PhysicalDeviceUnavailableError(this.manufacturer, 'modelo/firmware nao homologado');
    try {
      const receipt = await this.bridge.open(device, command);
      if (!receipt || receipt.authorizationId !== command.authorizationId || receipt.accepted !== true) {
        throw new Error('Comando nao confirmado pelo controlador');
      }
      return receipt;
    } catch {
      throw new PhysicalDeviceUnavailableError(this.manufacturer, 'falha no comando de liberacao');
    }
  }

  async verifyPassage(device: PhysicalDeviceDescriptor, event: PhysicalPassageEvent): Promise<boolean> {
    if (device.manufacturer !== this.manufacturer || event.deviceId !== device.deviceId) return false;
    if (!event.vendorEventId || !event.authorizationId || !Number.isFinite(event.occurredAt.getTime())) return false;
    try {
      return (await this.bridge.authenticatePassage(device, event)) === true;
    } catch {
      return false;
    }
  }
}

/**
 * Builds four strictly vendor-bound driver instances only when official
 * connectors were supplied. Undefined connectors are NOT replaced by mocks.
 */
export function createPhysicalVendorDrivers(
  connectors: Partial<Record<AccessManufacturer, VendorProtocolBridge>>,
): PhysicalAccessDriver[] {
  return SUPPORTED_PHYSICAL_MANUFACTURERS.flatMap((definition) => {
    const connector = connectors[definition.manufacturer];
    return connector
      ? [new VendorBridgedPhysicalDriver(definition.manufacturer, definition.transport, connector)]
      : [];
  });
}
