import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createCredential(dto: CreateCredentialDto, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
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

  async scan(qrToken: string, deviceId?: string) {
    const tokenHash = this.hash(qrToken);

    const credential = await this.prisma.accessCredential.findFirst({
      where: { tokenHash },
      include: { student: { include: { user: true } } },
    });

    let allowed = true;
    let denialReason: string | null = null;

    if (!credential) {
      allowed = false;
      denialReason = 'Credencial invalida';
    } else if (!credential.active) {
      allowed = false;
      denialReason = 'Credencial inativa';
    } else if (credential.expiresAt && credential.expiresAt < new Date()) {
      allowed = false;
      denialReason = 'Credencial expirada';
    } else if (credential.student.status !== 'ACTIVE') {
      allowed = false;
      denialReason = 'Matricula inativa';
    }

    let gymId: string | null = null;

    if (deviceId) {
      const device = await this.prisma.accessDevice.findUnique({
        where: { id: deviceId },
      });
      if (device) {
        gymId = device.gymId;
      }
    }

    if (!gymId && credential) {
      gymId = credential.student.gymId;
    }

    let eventId: string | null = null;

    if (gymId) {
      const event = await this.prisma.accessEvent.create({
        data: {
          gymId,
          studentId: credential ? credential.studentId : null,
          deviceId: deviceId || null,
          allowed,
          denialReason,
        } as any,
      });
      eventId = event.id;
    }

    return {
      allowed,
      denialReason,
      eventId,
      student: credential
        ? {
            id: credential.student.id,
            name: credential.student.user ? credential.student.user.name : null,
          }
        : null,
    };
  }
}
