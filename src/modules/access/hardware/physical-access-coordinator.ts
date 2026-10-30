import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessService } from '../access.service';
import {
  AccessManufacturer,
  PhysicalAccessDriverRegistry,
  PhysicalDirection,
  PhysicalPassageEvent,
} from './physical-access-driver';
import { nextPhysicalAccessState } from './physical-access-lifecycle';

const AUTHORIZATION_TTL_MS = 15_000;
const MANUFACTURERS: ReadonlyArray<AccessManufacturer> = ['CONTROL_ID', 'TOPDATA', 'HENRY', 'DIMEP'];

@Injectable()
export class PhysicalAccessCoordinator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonicalAccess: AccessService,
    private readonly drivers: PhysicalAccessDriverRegistry,
  ) {}

  private async denyPhysical(
    device: { id: string; gymId: string; manufacturer: string | null },
    eventId: string,
    studentId: string,
    direction: PhysicalDirection,
    reason: string,
  ) {
    await this.prisma.physicalAccessAttempt.create({
      data: {
        gymId: device.gymId,
        deviceId: device.id,
        studentId,
        decisionEventId: eventId,
        authorizationId: eventId,
        manufacturer: device.manufacturer || 'UNKNOWN',
        direction,
        denialReason: reason,
        state: 'DENIED',
        expiresAt: new Date(),
      },
    });
    return { allowed: false, denialReason: reason, authorizationId: null };
  }

  /**
   * Every request first passes through the existing canonical device-token,
   * nonce, tenant and credential checks. No hardware command is sent here.
   */
  async decide(input: {
    qrToken: string;
    deviceId: string;
    deviceToken: string;
    nonce: string;
    timestamp: number;
    direction: PhysicalDirection;
  }) {
    if (input.direction !== 'ENTRY' && input.direction !== 'EXIT') {
      throw new Error('Sentido de acesso invalido');
    }
    const decision = await this.canonicalAccess.scan(input);
    if (!decision.allowed || !decision.eventId || !decision.student) {
      return { allowed: false, denialReason: decision.denialReason, authorizationId: null };
    }

    const device = await this.prisma.accessDevice.findUnique({
      where: { id: input.deviceId },
      select: { id: true, gymId: true, active: true, manufacturer: true, model: true, firmwareVersion: true, certificationStatus: true, certificationRef: true },
    });
    if (!device || !device.active || !MANUFACTURERS.includes(device.manufacturer as AccessManufacturer)) {
      // AccessService's decision remains audited. Hardware must fail closed.
      return { allowed: false, denialReason: 'Controlador fisico nao configurado', authorizationId: null };
    }

    // Reuse the academy's canonical financial subscription status. Do not
    // invent a grace period, calculate balances, or allow a mere ACTIVE
    // student profile to bypass membership/payment authority.
    const gym = await this.prisma.gym.findUnique({
      where: { id: device.gymId },
      select: { active: true },
    });
    if (!gym?.active) {
      return this.denyPhysical(device, decision.eventId, decision.student.id, input.direction, 'Academia inativa');
    }
    const activeMembership = await this.prisma.subscription.findFirst({
      where: {
        gymId: device.gymId,
        studentId: decision.student.id,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      select: { id: true },
    });
    if (!activeMembership) {
      return this.denyPhysical(device, decision.eventId, decision.student.id, input.direction, 'Plano do aluno nao elegivel');
    }

    const manufacturer = device.manufacturer as AccessManufacturer;
    // The on-premise SDK is never loaded into the cloud backend. Only the
    // externally certified brand/model/firmware can use reverse polling.
    if (device.certificationStatus !== 'PRODUCTION_HOMOLOGATED' ||
        !device.certificationRef || !device.model || !device.firmwareVersion) {
      return this.denyPhysical(device, decision.eventId, decision.student.id, input.direction, 'Modelo de catraca nao homologado');
    }
    if (manufacturer === 'CONTROL_ID') {
      const driver = this.drivers.resolve(manufacturer);
      if (!driver.supportsDevice({
        deviceId: device.id, gymId: device.gymId,
        manufacturer, model: device.model, protocolVersion: device.firmwareVersion,
      })) {
        return this.denyPhysical(device, decision.eventId, decision.student.id, input.direction, 'Firmware de catraca nao homologado');
      }
    }
    const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_MS);
    const authorizationId = decision.eventId;
    const record = await this.prisma.physicalAccessAttempt.create({
      data: {
        gymId: device.gymId,
        deviceId: device.id,
        studentId: decision.student.id,
        decisionEventId: decision.eventId,
        authorizationId,
        manufacturer,
        direction: input.direction,
        state: nextPhysicalAccessState('REQUESTED', 'AUTHORIZE'),
        expiresAt,
      },
    });
    return { allowed: true, authorizationId: record.authorizationId, expiresAt, gymId: device.gymId };
  }

  /**
   * An authorized decision can trigger an official vendor connector once.
   * Drivers MUST implement command idempotency keyed by authorizationId:
   * a lost ACK may not cause two physical releases.
   */
  async release(authorizationId: string): Promise<boolean> {
    const now = new Date();
    const attempt = await this.prisma.physicalAccessAttempt.findUnique({
      where: { authorizationId },
    });
    if (!attempt || attempt.state !== 'AUTHORIZED' || attempt.expiresAt <= now) return false;

    const device = await this.prisma.accessDevice.findFirst({
      where: { id: attempt.deviceId, gymId: attempt.gymId, active: true },
      select: { id: true, gymId: true, manufacturer: true, model: true, firmwareVersion: true },
    });
    if (!device || device.manufacturer !== attempt.manufacturer) return false;

    const manufacturer = attempt.manufacturer as AccessManufacturer;
    const driver = this.drivers.resolve(manufacturer);
    // Reserve once in PostgreSQL BEFORE any external command. A lost ACK is
    // uncertain, never an invitation to send a second unlock command.
    const reserved = await this.prisma.physicalAccessAttempt.updateMany({
      where: { id: attempt.id, gymId: attempt.gymId, state: 'AUTHORIZED', expiresAt: { gt: new Date() } },
      data: { state: nextPhysicalAccessState('AUTHORIZED', 'RESERVE_RELEASE') },
    });
    if (reserved.count !== 1) return false;
    try {
      const receipt = await driver.release({
        deviceId: device.id,
        gymId: device.gymId,
        manufacturer,
        model: device.model || '',
        protocolVersion: device.firmwareVersion ?? undefined,
      }, {
        deviceId: attempt.deviceId,
        authorizationId,
        direction: attempt.direction as PhysicalDirection,
        expiresAt: attempt.expiresAt,
      });
      if (!receipt.accepted || receipt.authorizationId !== authorizationId) {
        throw new Error('ACK fisico invalido');
      }
      const updated = await this.prisma.physicalAccessAttempt.updateMany({
        where: { id: attempt.id, gymId: attempt.gymId, state: 'RELEASE_IN_FLIGHT' },
        data: { state: nextPhysicalAccessState('RELEASE_IN_FLIGHT', 'ACK_RELEASE') },
      });
      return updated.count === 1;
    } catch {
      await this.prisma.physicalAccessAttempt.updateMany({
        where: { id: attempt.id, gymId: attempt.gymId, state: 'RELEASE_IN_FLIGHT' },
        data: { state: nextPhysicalAccessState('RELEASE_IN_FLIGHT', 'UNKNOWN_RELEASE') },
      });
      return false;
    }
  }

  /**
   * Accept passage only after vendor-origin authentication and compare-and-
   * swap. A release ACK is not physical presence. Unknown transport is denied.
   */
  async confirmPassage(event: PhysicalPassageEvent): Promise<boolean> {
    if (event.outcome !== 'CONFIRMED') return false;
    const attempt = await this.prisma.physicalAccessAttempt.findUnique({
      where: { authorizationId: event.authorizationId },
    });
    if (!attempt || attempt.state !== 'COMMAND_ACCEPTED' || attempt.deviceId !== event.deviceId) return false;
    if (attempt.expiresAt < new Date() || event.occurredAt > attempt.expiresAt || event.occurredAt < attempt.createdAt) return false;

    const device = await this.prisma.accessDevice.findFirst({
      where: { id: attempt.deviceId, gymId: attempt.gymId, active: true },
      select: { id: true, gymId: true, manufacturer: true, model: true, firmwareVersion: true },
    });
    if (!device || device.manufacturer !== attempt.manufacturer) return false;
    const manufacturer = attempt.manufacturer as AccessManufacturer;
    const verified = await this.drivers.resolve(manufacturer).verifyPassage({
      deviceId: device.id,
      gymId: device.gymId,
      manufacturer,
      model: device.model || '',
      protocolVersion: device.firmwareVersion ?? undefined,
    }, event);
    if (!verified) return false;

    const result = await this.prisma.physicalAccessAttempt.updateMany({
      where: { id: attempt.id, gymId: attempt.gymId, state: 'COMMAND_ACCEPTED' },
      data: {
        state: nextPhysicalAccessState('COMMAND_ACCEPTED', 'CONFIRM_PASSAGE'),
        vendorEventId: event.vendorEventId,
      },
    });
    return result.count === 1;
  }
}
