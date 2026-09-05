import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatorIdentityStatus,
  CreatorStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangeCreatorStatusDto } from './dto/change-creator-status.dto';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { CreateCreatorIdentityDto } from './dto/create-creator-identity.dto';
import { RevokeCreatorIdentityDto } from './dto/revoke-creator-identity.dto';

const SERIALIZABLE_ATTEMPTS = 3;

@Injectable()
export class CreatorRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === SERIALIZABLE_ATTEMPTS) throw error;
      }
    }
    throw new ConflictException('Falha de concorrencia ao governar creator');
  }

  async findAll() {
    return this.prisma.creator.findMany({
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
      include: {
        identities: {
          orderBy: [{ providerCode: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  async findOne(creatorId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      include: {
        identities: {
          orderBy: [{ providerCode: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!creator) throw new NotFoundException('Creator nao encontrado');
    return creator;
  }

  async createCreator(dto: CreateCreatorDto, actorUserId?: string) {
    const slug = dto.slug.trim().toLowerCase();
    const displayName = dto.displayName.trim();
    const bio = dto.bio?.trim() || null;

    return this.serializable(async (tx) => {
      const existing = await tx.creator.findUnique({ where: { slug } });
      if (existing) {
        if (existing.displayName === displayName && existing.bio === bio) return existing;
        throw new ConflictException('creator slug ja existe com definicao diferente');
      }

      const creator = await tx.creator.create({
        data: {
          slug,
          displayName,
          bio,
          status: CreatorStatus.PENDING,
        },
      });

      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'CREATOR_REGISTERED',
          entity: 'Creator',
          entityId: creator.id,
          next: {
            slug: creator.slug,
            displayName: creator.displayName,
            status: creator.status,
          },
        },
        tx,
      );

      return creator;
    });
  }

  async changeStatus(
    creatorId: string,
    dto: ChangeCreatorStatusDto,
    actorUserId?: string,
  ) {
    const target = dto.status as CreatorStatus;
    const reason = dto.reason?.trim() || null;

    return this.serializable(async (tx) => {
      const creator = await tx.creator.findUnique({ where: { id: creatorId } });
      if (!creator) throw new NotFoundException('Creator nao encontrado');
      if (creator.status === target) return creator;
      if (creator.status === CreatorStatus.RETIRED) {
        throw new ConflictException('Creator RETIRED possui lifecycle terminal');
      }

      if (target === CreatorStatus.ACTIVE) {
        if (
          creator.status !== CreatorStatus.PENDING &&
          creator.status !== CreatorStatus.SUSPENDED
        ) {
          throw new ConflictException('Transicao para ACTIVE nao autorizada');
        }
        const verifiedIdentities = await tx.creatorIdentity.count({
          where: {
            creatorId,
            status: CreatorIdentityStatus.VERIFIED,
          },
        });
        if (verifiedIdentities === 0) {
          throw new BadRequestException(
            'Creator somente pode ficar ACTIVE com identidade VERIFIED',
          );
        }
      }

      if (target === CreatorStatus.SUSPENDED) {
        if (creator.status !== CreatorStatus.ACTIVE) {
          throw new ConflictException('Somente Creator ACTIVE pode ser suspenso');
        }
        if (!reason) {
          throw new BadRequestException('Suspensao exige motivo auditavel');
        }
      }

      if (target === CreatorStatus.RETIRED && !reason) {
        throw new BadRequestException('Retirement exige motivo auditavel');
      }

      const updated = await tx.creator.update({
        where: { id: creatorId },
        data: { status: target },
      });

      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'CREATOR_STATUS_CHANGED',
          entity: 'Creator',
          entityId: creator.id,
          previous: { status: creator.status },
          next: { status: updated.status, reason },
        },
        tx,
      );

      return updated;
    });
  }

  async addIdentity(
    creatorId: string,
    dto: CreateCreatorIdentityDto,
    actorUserId?: string,
  ) {
    const providerCode = dto.providerCode.trim().toUpperCase();
    const externalSubject = dto.externalSubject.trim();
    const handle = dto.handle?.trim() || null;
    const profileUrl = dto.profileUrl?.trim() || null;

    return this.serializable(async (tx) => {
      const creator = await tx.creator.findUnique({ where: { id: creatorId } });
      if (!creator) throw new NotFoundException('Creator nao encontrado');
      if (creator.status === CreatorStatus.RETIRED) {
        throw new ConflictException('Creator RETIRED nao recebe nova identidade');
      }

      const existing = await tx.creatorIdentity.findUnique({
        where: {
          providerCode_externalSubject: {
            providerCode,
            externalSubject,
          },
        },
      });
      if (existing) {
        if (existing.creatorId === creatorId) return existing;
        throw new ConflictException('Identidade ja vinculada a outro Creator');
      }

      const identity = await tx.creatorIdentity.create({
        data: {
          creatorId,
          providerCode,
          externalSubject,
          handle,
          profileUrl,
          status: CreatorIdentityStatus.UNVERIFIED,
        },
      });

      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'CREATOR_IDENTITY_REGISTERED',
          entity: 'CreatorIdentity',
          entityId: identity.id,
          next: {
            creatorId,
            providerCode,
            externalSubject,
            handle,
            profileUrl,
            status: identity.status,
          },
        },
        tx,
      );

      return identity;
    });
  }

  async verifyIdentity(
    creatorId: string,
    identityId: string,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      const creator = await tx.creator.findUnique({ where: { id: creatorId } });
      if (!creator) throw new NotFoundException('Creator nao encontrado');
      if (creator.status === CreatorStatus.RETIRED) {
        throw new ConflictException('Creator RETIRED nao pode verificar identidade');
      }

      const identity = await tx.creatorIdentity.findFirst({
        where: { id: identityId, creatorId },
      });
      if (!identity) throw new NotFoundException('CreatorIdentity nao encontrada');
      if (identity.status === CreatorIdentityStatus.VERIFIED) return identity;
      if (identity.status === CreatorIdentityStatus.REVOKED) {
        throw new ConflictException('Identidade REVOKED possui lifecycle terminal');
      }

      const verifiedAt = new Date();
      const updated = await tx.creatorIdentity.update({
        where: { id: identity.id },
        data: {
          status: CreatorIdentityStatus.VERIFIED,
          verifiedAt,
        },
      });

      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'CREATOR_IDENTITY_VERIFIED',
          entity: 'CreatorIdentity',
          entityId: identity.id,
          previous: { status: identity.status },
          next: {
            status: updated.status,
            verifiedAt: verifiedAt.toISOString(),
          },
        },
        tx,
      );

      return updated;
    });
  }

  async revokeIdentity(
    creatorId: string,
    identityId: string,
    dto: RevokeCreatorIdentityDto,
    actorUserId?: string,
  ) {
    const reason = dto.reason.trim();

    return this.serializable(async (tx) => {
      const creator = await tx.creator.findUnique({ where: { id: creatorId } });
      if (!creator) throw new NotFoundException('Creator nao encontrado');

      const identity = await tx.creatorIdentity.findFirst({
        where: { id: identityId, creatorId },
      });
      if (!identity) throw new NotFoundException('CreatorIdentity nao encontrada');

      if (identity.status === CreatorIdentityStatus.REVOKED) {
        return { creator, identity };
      }

      const revokedAt = new Date();
      const updatedIdentity = await tx.creatorIdentity.update({
        where: { id: identity.id },
        data: {
          status: CreatorIdentityStatus.REVOKED,
          revokedAt,
        },
      });

      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'CREATOR_IDENTITY_REVOKED',
          entity: 'CreatorIdentity',
          entityId: identity.id,
          previous: { status: identity.status },
          next: {
            status: updatedIdentity.status,
            revokedAt: revokedAt.toISOString(),
            reason,
          },
        },
        tx,
      );

      let updatedCreator = creator;
      if (creator.status === CreatorStatus.ACTIVE) {
        const verifiedIdentities = await tx.creatorIdentity.count({
          where: {
            creatorId,
            id: { not: identity.id },
            status: CreatorIdentityStatus.VERIFIED,
          },
        });
        if (verifiedIdentities === 0) {
          updatedCreator = await tx.creator.update({
            where: { id: creatorId },
            data: { status: CreatorStatus.SUSPENDED },
          });
          await this.audit.record(
            {
              gymId: null,
              userId: actorUserId ?? null,
              action: 'CREATOR_AUTO_SUSPENDED_NO_VERIFIED_IDENTITY',
              entity: 'Creator',
              entityId: creator.id,
              previous: { status: creator.status },
              next: {
                status: updatedCreator.status,
                reason: 'LAST_VERIFIED_IDENTITY_REVOKED',
              },
            },
            tx,
          );
        }
      }

      return { creator: updatedCreator, identity: updatedIdentity };
    });
  }
}
