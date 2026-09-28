import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataSubjectRequestStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import {
  CreateDataSubjectRequestDto,
  UpdateDataSubjectRequestDto,
} from './dto/data-subject-request.dto';

const TERMINAL = new Set<DataSubjectRequestStatus>([
  DataSubjectRequestStatus.FULFILLED,
  DataSubjectRequestStatus.DENIED,
  DataSubjectRequestStatus.CANCELLED,
]);

const ALLOWED_TRANSITIONS: Record<
  DataSubjectRequestStatus,
  readonly DataSubjectRequestStatus[]
> = {
  RECEIVED: [
    DataSubjectRequestStatus.IDENTITY_VERIFICATION,
    DataSubjectRequestStatus.IN_REVIEW,
    DataSubjectRequestStatus.CANCELLED,
  ],
  IDENTITY_VERIFICATION: [
    DataSubjectRequestStatus.IN_REVIEW,
    DataSubjectRequestStatus.DENIED,
    DataSubjectRequestStatus.CANCELLED,
  ],
  IN_REVIEW: [
    DataSubjectRequestStatus.FULFILLED,
    DataSubjectRequestStatus.DENIED,
    DataSubjectRequestStatus.CANCELLED,
  ],
  FULFILLED: [],
  DENIED: [],
  CANCELLED: [],
};

@Injectable()
export class DataSubjectRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authSecurity: AuthSecurityService,
  ) {}

  private async assertSubjectMembership(
    userId: string,
    gymId: string,
  ) {
    const membership = await this.prisma.userRole.findFirst({
      where: {
        userId,
        gymId,
      },
      select: { id: true },
    });
    if (membership) return;

    const student = await this.prisma.student.findFirst({
      where: {
        gymId,
        userId,
      },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException(
        'Titular nao pertence ao tenant ativo',
      );
    }
  }

  async create(
    dto: CreateDataSubjectRequestDto,
    gymId: string,
    userId: string,
  ) {
    await this.assertSubjectMembership(userId, gymId);

    const existing =
      await this.prisma.dataSubjectRequest.findUnique({
        where: { requestId: dto.requestId },
      });
    if (existing) {
      const same =
        existing.gymId === gymId &&
        existing.subjectUserId === userId &&
        existing.requestType === dto.requestType;
      if (!same) {
        throw new ConflictException(
          'requestId de privacidade ja vinculado a outra solicitacao',
        );
      }
      return {
        ...existing,
        idempotent: true,
      };
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dataSubjectRequest.create({
          data: {
            requestId: dto.requestId,
            gymId,
            subjectUserId: userId,
            requestType: dto.requestType,
          },
        });

        await this.audit.record(
          {
            gymId,
            userId,
            action: 'DATA_SUBJECT_REQUEST_RECEIVED',
            entity: 'DataSubjectRequest',
            entityId: row.id,
            next: {
              requestType: row.requestType,
              status: row.status,
            },
          },
          tx,
        );

        return row;
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      ...created,
      idempotent: false,
    };
  }

  async listMine(gymId: string, userId: string) {
    await this.assertSubjectMembership(userId, gymId);
    return this.prisma.dataSubjectRequest.findMany({
      where: {
        gymId,
        subjectUserId: userId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listTenant(gymId: string) {
    return this.prisma.dataSubjectRequest.findMany({
      where: { gymId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    dto: UpdateDataSubjectRequestDto,
    gymId: string,
    actorUserId: string,
  ) {
    await this.authSecurity.assertStepUp(
      actorUserId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );

    const previous =
      await this.prisma.dataSubjectRequest.findFirst({
        where: { id, gymId },
      });
    if (!previous) {
      throw new NotFoundException(
        'Solicitacao de titular nao encontrada',
      );
    }
    if (TERMINAL.has(previous.status)) {
      if (previous.status === dto.status) return previous;
      throw new ConflictException(
        'Solicitacao de titular ja esta em estado terminal',
      );
    }
    if (
      !ALLOWED_TRANSITIONS[previous.status].includes(dto.status)
    ) {
      throw new ConflictException(
        'Transicao de solicitacao de titular invalida',
      );
    }

    const verifiedAt =
      dto.identityVerified === true
        ? previous.identityVerifiedAt ?? new Date()
        : previous.identityVerifiedAt;

    if (
      (dto.status === DataSubjectRequestStatus.FULFILLED ||
        dto.status === DataSubjectRequestStatus.DENIED) &&
      !verifiedAt
    ) {
      throw new BadRequestException(
        'Resolucao exige verificacao de identidade',
      );
    }
    if (
      (dto.status === DataSubjectRequestStatus.FULFILLED ||
        dto.status === DataSubjectRequestStatus.DENIED) &&
      !dto.resolutionCode
    ) {
      throw new BadRequestException(
        'Resolucao exige resolutionCode',
      );
    }

    const resolvedAt = TERMINAL.has(dto.status)
      ? new Date()
      : null;

    return this.prisma.$transaction(async (tx) => {
      const changed =
        await tx.dataSubjectRequest.updateMany({
          where: {
            id: previous.id,
            gymId,
            status: previous.status,
            updatedAt: previous.updatedAt,
          },
          data: {
            status: dto.status,
            identityVerifiedAt: verifiedAt,
            resolutionCode:
              dto.resolutionCode ?? previous.resolutionCode,
            resolvedAt,
          },
        });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Solicitacao mudou durante processamento',
        );
      }

      const updated =
        await tx.dataSubjectRequest.findUniqueOrThrow({
          where: { id: previous.id },
        });

      await this.audit.record(
        {
          gymId,
          userId: actorUserId,
          action: 'DATA_SUBJECT_REQUEST_UPDATED',
          entity: 'DataSubjectRequest',
          entityId: updated.id,
          previous: {
            status: previous.status,
            identityVerified:
              Boolean(previous.identityVerifiedAt),
            resolutionCode: previous.resolutionCode,
          },
          next: {
            status: updated.status,
            identityVerified:
              Boolean(updated.identityVerifiedAt),
            resolutionCode: updated.resolutionCode,
            resolvedAt: updated.resolvedAt,
          },
        },
        tx,
      );

      return updated;
    });
  }
}
