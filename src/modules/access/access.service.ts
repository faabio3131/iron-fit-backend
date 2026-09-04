import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const SCAN_MAX_AGE_MS = 2 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashesEqual(left: string, right: string): boolean {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async recordEvent(params: {
    gymId: string;
    deviceId: string;
    studentId?: string | null;
    allowed: boolean;
    denialReason?: string | null;
  }) {
    return this.prisma.accessEvent.create({
      data: {
        gymId: params.gymId,
        deviceId: params.deviceId,
        studentId: params.studentId ?? null,
        allowed: params.allowed,
        denialReason: params.denialReason ?? null,
      } as any,
    });
  }

  async createCredential(dto: CreateCredentialDto, gymId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, gymId },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    const rawToken = randomBytes(24).toString('hex');
    const tokenHash = this.hash(rawToken);

    const credential = await this.prisma.accessCredential.create({
      data: {
        studentId: dto.studentId,
        type: dto.type || 'QR_CODE',
        tokenHash,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      } as any,
    });

    return {
      credentialId: credential.id,
      qrToken: rawToken,
      type: credential.type,
      active: credential.active,
      aviso: 'Guarde o qrToken: ele vira o QR Code e nao sera exibido novamente',
    };
  }

  async provisionDeviceToken(deviceId: string, gymId: string) {
    const device = await this.prisma.accessDevice.findFirst({
      where: { id: deviceId, gymId, active: true },
    });

    if (!device) {
      throw new NotFoundException('Dispositivo nao encontrado');
    }

    const rawToken = randomBytes(32).toString('base64url');
    await this.prisma.accessDevice.update({
      where: { id: device.id },
      data: {
        deviceTokenHash: this.hash(rawToken),
        tokenRotatedAt: new Date(),
      },
    });

    return {
      deviceId: device.id,
      deviceToken: rawToken,
      aviso: 'Guarde o deviceToken: ele nao sera exibido novamente',
    };
  }

  async scan(params: {
    qrToken: string;
    deviceId: string;
    deviceToken: string;
    nonce: string;
    timestamp: number;
  }) {
    const now = new Date();
    const device = await this.prisma.accessDevice.findUnique({
      where: { id: params.deviceId },
    });

    if (!device) {
      return { allowed: false, denialReason: 'Dispositivo invalido', eventId: null, student: null };
    }

    if (!device.active) {
      const event = await this.recordEvent({
        gymId: device.gymId,
        deviceId: device.id,
        allowed: false,
        denialReason: 'Dispositivo inativo',
      });
      return { allowed: false, denialReason: 'Dispositivo inativo', eventId: event.id, student: null };
    }

    const suppliedHash = this.hash(params.deviceToken);
    if (!device.deviceTokenHash || !this.hashesEqual(device.deviceTokenHash, suppliedHash)) {
      const event = await this.recordEvent({
        gymId: device.gymId,
        deviceId: device.id,
        allowed: false,
        denialReason: 'Autenticacao do dispositivo invalida',
      });
      return { allowed: false, denialReason: 'Autenticacao do dispositivo invalida', eventId: event.id, student: null };
    }

    if (!Number.isSafeInteger(params.timestamp) || Math.abs(Date.now() - params.timestamp) > SCAN_MAX_AGE_MS) {
      const event = await this.recordEvent({
        gymId: device.gymId,
        deviceId: device.id,
        allowed: false,
        denialReason: 'Requisicao de acesso expirada',
      });
      return { allowed: false, denialReason: 'Requisicao de acesso expirada', eventId: event.id, student: null };
    }

    try {
      await this.prisma.accessScanNonce.deleteMany({
        where: { deviceId: device.id, expiresAt: { lt: now } },
      });
      await this.prisma.accessScanNonce.create({
        data: {
          deviceId: device.id,
          nonce: params.nonce,
          expiresAt: new Date(now.getTime() + NONCE_TTL_MS),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const event = await this.recordEvent({
          gymId: device.gymId,
          deviceId: device.id,
          allowed: false,
          denialReason: 'Replay detectado',
        });
        return { allowed: false, denialReason: 'Replay detectado', eventId: event.id, student: null };
      }
      throw error;
    }

    const tokenHash = this.hash(params.qrToken);
    const credential = await this.prisma.accessCredential.findFirst({
      where: { tokenHash },
      include: { student: { include: { user: true } } },
    });

    let allowed = true;
    let denialReason: string | null = null;

    if (!credential) {
      allowed = false;
      denialReason = 'Credencial invalida';
    } else if (credential.student.gymId !== device.gymId) {
      allowed = false;
      denialReason = 'Credencial de outra academia';
    } else if (!credential.active) {
      allowed = false;
      denialReason = 'Credencial inativa';
    } else if (credential.expiresAt && credential.expiresAt < now) {
      allowed = false;
      denialReason = 'Credencial expirada';
    } else if (credential.student.status !== 'ACTIVE') {
      allowed = false;
      denialReason = 'Matricula inativa';
    }

    const event = await this.recordEvent({
      gymId: device.gymId,
      deviceId: device.id,
      studentId: credential?.studentId ?? null,
      allowed,
      denialReason,
    });

    return {
      allowed,
      denialReason,
      eventId: event.id,
      student: credential
        ? {
            id: credential.student.id,
            name: credential.student.user ? credential.student.user.name : null,
          }
        : null,
    };
  }
}
