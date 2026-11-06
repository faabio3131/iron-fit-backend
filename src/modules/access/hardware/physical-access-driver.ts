/**
 * Manufacturer boundary for physical access controllers.
 * No vendor can bypass AccessService's canonical tenant-scoped decision.
 * Vendor SDKs/protocols belong exclusively in implementations of this port.
 */
export type AccessManufacturer = 'CONTROL_ID' | 'TOPDATA' | 'HENRY' | 'DIMEP';
export type PhysicalDirection = 'ENTRY' | 'EXIT';
export type PhysicalOutcome = 'CONFIRMED' | 'NOT_CONFIRMED' | 'UNKNOWN';

export interface PhysicalDeviceDescriptor {
  deviceId: string;
  gymId: string;
  manufacturer: AccessManufacturer;
  model: string;
  protocolVersion?: string;
}

export interface PhysicalIdentityEvent {
  deviceId: string;
  eventId: string;
  credential: string;
  occurredAt: Date;
  direction: PhysicalDirection;
}

export interface PhysicalReleaseCommand {
  deviceId: string;
  authorizationId: string;
  direction: PhysicalDirection;
  expiresAt: Date;
}

export interface PhysicalReleaseReceipt {
  authorizationId: string;
  accepted: boolean;
  vendorEventId?: string;
}

export interface PhysicalPassageEvent {
  deviceId: string;
  authorizationId: string;
  vendorEventId: string;
  occurredAt: Date;
  outcome: PhysicalOutcome;
}

/**
 * Transports must authenticate their local peer, validate the configured
 * device ID and bind the connection to the gym before forwarding events.
 * The receipt ACKs the command only, never the physical passage.
 */
export interface PhysicalAccessDriver {
  readonly manufacturer: AccessManufacturer;
  readonly transport: 'REST' | 'LOCAL_SDK' | 'PROPRIETARY';
  supportsDevice(device: PhysicalDeviceDescriptor): boolean;
  release(device: PhysicalDeviceDescriptor, command: PhysicalReleaseCommand): Promise<PhysicalReleaseReceipt>;
  verifyPassage(device: PhysicalDeviceDescriptor, event: PhysicalPassageEvent): Promise<boolean>;
}

export class PhysicalDeviceUnavailableError extends Error {
  constructor(public readonly manufacturer: AccessManufacturer, reason: string) {
    super(`${manufacturer}: ${reason}`);
    this.name = 'PhysicalDeviceUnavailableError';
  }
}

/**
 * Explicit allow-list. No default permissive implementation and no
 * cross-manufacturer fallback. Missing vendor protocols fail closed.
 */
export class PhysicalAccessDriverRegistry {
  private readonly drivers = new Map<AccessManufacturer, PhysicalAccessDriver>();

  register(driver: PhysicalAccessDriver): void {
    if (this.drivers.has(driver.manufacturer)) {
      throw new Error(`Driver already registered: ${driver.manufacturer}`);
    }
    this.drivers.set(driver.manufacturer, driver);
  }

  resolve(manufacturer: AccessManufacturer): PhysicalAccessDriver {
    const driver = this.drivers.get(manufacturer);
    if (!driver) {
      throw new PhysicalDeviceUnavailableError(manufacturer, 'driver nao homologado ou indisponivel');
    }
    return driver;
  }

  available(): AccessManufacturer[] {
    return [...this.drivers.keys()];
  }
}

/** Bind one device's transport to its canonical tenant and reject spoofing. */
export function assertPhysicalDeviceScope(
  expected: PhysicalDeviceDescriptor,
  actualDeviceId: string,
  actualGymId: string,
): void {
  if (!expected.deviceId || !expected.gymId || expected.deviceId !== actualDeviceId || expected.gymId !== actualGymId) {
    throw new Error('Dispositivo ou academia incompatível');
  }
}

export function assertFreshPhysicalCommand(command: PhysicalReleaseCommand, now = new Date()): void {
  if (!command.authorizationId || !command.deviceId || !Number.isFinite(command.expiresAt.getTime()) || command.expiresAt <= now) {
    throw new Error('Autorizacao fisica expirada ou invalida');
  }
}
