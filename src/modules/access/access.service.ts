import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const SCAN_MAX_AGE_MS = 2 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const ACCESS_EVENT_HISTORY_LIMIT = 200;

@Injectable()
export class AccessService {
  private readonly audit: AuditService;

  constructor(private prisma: PrismaService) {
    this.audit = new AuditService(prisma);
  }

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
    const event = await this.prisma.accessEvent.create({
      data: {
        gymId: params.gymId,
        deviceId: params.deviceId,
        studentId: params.studentId ?? null,
        allowed: params.allowed,
        denialReason: params.denialReason ?? null,
      } as any,
    });

    await this.audit.record({
      gymId: params.gymId,
      action: 'ACCESS_DECISION_RECORDED',
      entity: 'AccessEvent',
      entityId: event.id,
      next: {
        deviceId: params.deviceId,
        studentId: params.studentId ?? null,
        allowed: params.allowed,
        denialReason: params.denialReason ?? null,
      },
    });

    return event;
  }

  private parseBooleanFilter(value: string | undefined, label: string) {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new BadRequestException(`${label} deve ser true ou false`);
  }

  private parseDateFilter(value: string | undefined, label: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Data ${label} invalida`);
    }
    return date;
  }

  async findRecentEvents(
    gymId: string,
    filters: {
      studentId?: string;
      deviceId?: string;
      allowed?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const allowed = this.parseBooleanFilter(filters.allowed, 'allowed');
    const from = this.parseDateFilter(filters.from, 'inicial');
    const to = this.parseDateFilter(filters.to, 'final');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'Data inicial nao pode ser posterior a data final',
      );
    }

    return this.prisma.accessEvent.findMany({
      where: {
        gymId,
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
        ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
        ...(allowed !== undefined ? { allowed } : {}),
        ...(from || to
          ? {
              occurredAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: ACCESS_EVENT_HISTORY_LIMIT,
      select: {
        id: true,
        deviceId: true,
        studentId: true,
        allowed: true,
        denialReason: true,
        occurredAt: true,
        student: {
          select: {
            id: true,
            user: { select: { name: true, email: true } },
          },
        },
        device: {
          select: {
            id: true,
            name: true,
            type: true,
            active: true,
          },
        },
      },
    });
  }

  async findCredentials(
    gymId: string,
    filters: { studentId?: string; active?: string } = {},
  ) {
    const active = this.parseBooleanFilter(filters.active, 'active');
    const credentials = await this.prisma.accessCredential.findMany({
      where: {
        student: { gymId },
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
        ...(active !== undefined ? { active } : {}),
      },
      take: 500,
      select: {
        id: true,
        studentId: true,
        type: true,
        active: true,
        expiresAt: true,
        student: {
          select: {
            id: true,
            status: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
    const now = new Date();
    return credentials.map((credential) => ({
      ...credential,
      status: !credential.active
        ? 'INACTIVE'
        : credential.expiresAt && credential.expiresAt < now
          ? 'EXPIRED'
          : 'ACTIVE',
    }));
  }

  async revokeCredential(
    id: string,
    gymId: string,
    actorUserId?: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const credential = await tx.accessCredential.findFirst({
          where: { id, student: { gymId } },
          select: {
            id: true,
            studentId: true,
            type: true,
            active: true,
            expiresAt: true,
          },
        });
        if (!credential) {
          throw new NotFoundException('Credencial nao encontrada');
        }

        // Revocation is idempotent. A lost race must not generate a false
        // audit or revoke a credential whose student left this tenant.
        if (!credential.active) {
          return { ...credential, status: 'INACTIVE' };
        }
        const revoked = await tx.accessCredential.update({
          where: { id: credential.id, active: true, student: { gymId } },
          data: { active: false },
          select: {
            id: true,
            studentId: true,
            type: true,
            active: true,
            expiresAt: true,
          },
        });

        await this.audit.record({
          gymId,
          userId: actorUserId ?? null,
          action: 'ACCESS_CREDENTIAL_REVOKED',
          entity: 'AccessCredential',
          entityId: credential.id,
          previous: { active: true },
          next: { active: false },
        }, tx);

        return { ...revoked, status: 'INACTIVE' };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2025' || error.code === 'P2034')
      ) {
        throw new ConflictException('Credencial alterada por outra operacao; atualize e tente novamente');
      }
      throw error;
    }
  }

  async findDevices(
    gymId: string,
    filters: { active?: string } = {},
  ) {
    const active = this.parseBooleanFilter(filters.active, 'active');
    return this.prisma.accessDevice.findMany({
      where: {
        gymId,
        ...(active !== undefined ? { active } : {}),
      },
      orderBy: { name: 'asc' },
      take: 200,
      select: {
        id: true,
        name: true,
        type: true,
        protocol: true,
        manufacturer: true,
        model: true,
        active: true,
        lastSyncAt: true,
        tokenRotatedAt: true,
      },
    });
  }

  async createCredential(
    dto: CreateCredentialDto,
    gymId: string,
    actorUserId?: string,
  ) {
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

    await this.audit.record({
      gymId,
      userId: actorUserId ?? null,
      action: 'ACCESS_CREDENTIAL_CREATED',
      entity: 'AccessCredential',
      entityId: credential.id,
      next: {
        studentId: dto.studentId,
        type: credential.type,
        active: credential.active,
        expiresAt: credential.expiresAt,
      },
    });

    return {
      credentialId: credential.id,
      qrToken: rawToken,
      type: credential.type,
      active: credential.active,
      aviso: 'Guarde o qrToken: ele vira o QR Code e nao sera exibido novamente',
    };
  }

  async provisionDeviceToken(
    deviceId: string,
    gymId: string,
    actorUserId?: string,
    allowInactiveEnrollment = false,
  ) {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenRotatedAt = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        const device = await tx.accessDevice.findFirst({
          where: { id: deviceId, gymId, active: !allowInactiveEnrollment },
          select: { id: true },
        });
        if (!device) {
          throw new NotFoundException('Dispositivo nao encontrado');
        }

        // Do not provision secrets for a device that changed tenant/status
        // after the read; rotate token and audit in one DB transaction.
        await tx.accessDevice.update({
          where: { id: device.id, gymId, active: !allowInactiveEnrollment },
          data: {
            deviceTokenHash: this.hash(rawToken),
            tokenRotatedAt,
          },
        });

        await this.audit.record({
          gymId,
          userId: actorUserId ?? null,
          action: 'ACCESS_DEVICE_TOKEN_ROTATED',
          entity: 'AccessDevice',
          entityId: device.id,
          next: { tokenRotatedAt },
        }, tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2025' || error.code === 'P2034')
      ) {
        throw new ConflictException('Dispositivo alterado por outra operacao; atualize e tente novamente');
      }
      throw error;
    }

    return {
      deviceId,
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

    const credentialBelongsToGym =
      credential !== null && credential.student.gymId === device.gymId;

    let allowed = true;
    let denialReason: string | null = null;

    if (!credential) {
      allowed = false;
      denialReason = 'Credencial invalida';
    } else if (!credentialBelongsToGym) {
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

    const safeStudentId = credentialBelongsToGym ? credential!.studentId : null;
    const event = await this.recordEvent({
      gymId: device.gymId,
      deviceId: device.id,
      studentId: safeStudentId,
      allowed,
      denialReason,
    });

    return {
      allowed,
      denialReason,
      eventId: event.id,
      student: allowed && credentialBelongsToGym && credential
        ? {
            id: credential.student.id,
            name: credential.student.user ? credential.student.user.name : null,
          }
        : null,
    };
  }
}
