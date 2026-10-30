import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PhysicalAccessCoordinator } from './physical-access-coordinator';
import {
  GatewayAckDto, GatewayClaimDto, GatewayDeviceAuthDto,
  GatewayIdentifyDto, GatewayPassageDto,
} from '../dto/physical-gateway.dto';

const MAX_REQUEST_AGE_MS = 60_000;
const MAX_PASSAGE_AGE_MS = 120_000;
const NONCE_TTL_MS = 120_000;
const SUPPORTED = new Set(['TOPDATA', 'HENRY', 'DIMEP']);

/**
 * Reverse-poll contract for vendor SDKs installed in the gym's LAN.
 * All requests originate from the private on-premise gateway toward HTTPS
 * IRON. No inbound router/NAT port needs to be opened at the gym.
 */
@Injectable()
export class PhysicalGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: PhysicalAccessCoordinator,
  ) {}

  private equalHex(left: string, right: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async authenticate(input: GatewayDeviceAuthDto) {
    const now = Date.now();
    if (!Number.isSafeInteger(input.timestamp) || Math.abs(now - input.timestamp) > MAX_REQUEST_AGE_MS) {
      throw new UnauthorizedException('Credencial ou timestamp de gateway inválido');
    }
    const device = await this.prisma.accessDevice.findFirst({
      where: { id: input.deviceId, active: true },
      select: { id: true, gymId: true, manufacturer: true, deviceTokenHash: true, active: true, certificationStatus: true, certificationRef: true, model: true, firmwareVersion: true },
    });
    if (!device || !device.deviceTokenHash || !SUPPORTED.has(device.manufacturer || '') ||
        (!device.model || !device.firmwareVersion || device.certificationStatus !== 'PRODUCTION_HOMOLOGATED' || !device.certificationRef) ||
        !this.equalHex(createHash('sha256').update(input.deviceToken).digest('hex'), device.deviceTokenHash)) {
      throw new UnauthorizedException('Credencial ou timestamp de gateway inválido');
    }
    await this.prisma.accessScanNonce.deleteMany({
      where: { deviceId: device.id, expiresAt: { lt: new Date(now) } },
    });
    try {
      await this.prisma.accessScanNonce.create({
        data: {
          deviceId: device.id,
          nonce: input.nonce,
          expiresAt: new Date(now + NONCE_TTL_MS),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new UnauthorizedException('Evento duplicado');
      }
      throw error;
    }
    return device;
  }

  /** The canonical scan must own the nonce. Do not authenticate twice. */
  async identify(input: GatewayIdentifyDto) {
    return this.coordinator.decide({
      deviceId: input.deviceId,
      deviceToken: input.deviceToken,
      nonce: input.nonce,
      timestamp: input.timestamp,
      qrToken: input.qrToken,
      direction: input.direction,
    });
  }

  async claim(input: GatewayClaimDto) {
    const device = await this.authenticate(input);
    const now = new Date();
    const next = await this.prisma.physicalAccessAttempt.findFirst({
      where: {
        gymId: device.gymId,
        deviceId: device.id,
        manufacturer: device.manufacturer!,
        state: 'AUTHORIZED',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) return { command: null };
    const claimed = await this.prisma.physicalAccessAttempt.updateMany({
      where: {
        id: next.id,
        gymId: device.gymId,
        deviceId: device.id,
        state: 'AUTHORIZED',
        expiresAt: { gt: new Date() },
      },
      data: { state: 'RELEASE_IN_FLIGHT' },
    });
    if (claimed.count !== 1) return { command: null };
    // The client must never infer a new command from a lost HTTP response.
    // A claimed authorization is never returned a second time.
    return {
      command: {
        authorizationId: next.authorizationId,
        deviceId: next.deviceId,
        manufacturer: next.manufacturer,
        direction: next.direction,
        expiresAt: next.expiresAt,
      },
    };
  }

  async ack(input: GatewayAckDto) {
    const device = await this.authenticate(input);
    const attempt = await this.prisma.physicalAccessAttempt.findFirst({
      where: {
        authorizationId: input.authorizationId,
        deviceId: device.id,
        gymId: device.gymId,
        manufacturer: device.manufacturer!,
      },
    });
    if (!attempt || attempt.state !== 'RELEASE_IN_FLIGHT') return { accepted: false };
    const newState = input.status === 'ACCEPTED' && attempt.expiresAt > new Date()
      ? 'COMMAND_ACCEPTED'
      : 'RELEASE_UNCERTAIN';
    const result = await this.prisma.physicalAccessAttempt.updateMany({
      where: { id: attempt.id, gymId: device.gymId, deviceId: device.id, state: 'RELEASE_IN_FLIGHT' },
      data: { state: newState },
    });
    return { accepted: result.count === 1 && newState === 'COMMAND_ACCEPTED' };
  }

  async passage(input: GatewayPassageDto) {
    const device = await this.authenticate(input);
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.getTime()) ||
        Math.abs(Date.now() - occurredAt.getTime()) > MAX_PASSAGE_AGE_MS) {
      throw new ForbiddenException('Passagem inválida ou fora da janela temporal');
    }
    const signedPayload = JSON.stringify([
      device.id, device.gymId, device.manufacturer, input.authorizationId,
      input.vendorEventId, occurredAt.toISOString(), input.outcome,
    ]);
    const provided = input.signature.toLowerCase();
    const expected = createHmac('sha256', input.deviceToken).update(signedPayload).digest('hex');
    if (!this.equalHex(expected, provided)) throw new ForbiddenException('Evento físico não autenticado');

    const attempt = await this.prisma.physicalAccessAttempt.findFirst({
      where: {
        authorizationId: input.authorizationId, deviceId: device.id,
        gymId: device.gymId, manufacturer: device.manufacturer!,
      },
    });
    if (!attempt || attempt.state !== 'COMMAND_ACCEPTED' ||
        attempt.expiresAt < occurredAt || occurredAt < attempt.createdAt) return { confirmed: false };

    try {
      const result = await this.prisma.physicalAccessAttempt.updateMany({
        where: {
          id: attempt.id,
          gymId: device.gymId, deviceId: device.id,
          state: 'COMMAND_ACCEPTED',
        },
        data: {
          state: input.outcome === 'CONFIRMED' ? 'PASSAGE_CONFIRMED' : 'PASSAGE_NOT_CONFIRMED',
          vendorEventId: input.vendorEventId,
        },
      });
      return { confirmed: result.count === 1 && input.outcome === 'CONFIRMED' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { confirmed: false };
      }
      throw error;
    }
  }
}
