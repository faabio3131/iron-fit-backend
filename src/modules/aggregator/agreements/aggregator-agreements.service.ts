import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AggregatorAgreementStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { CreateAggregatorAgreementDto } from './dto/create-aggregator-agreement.dto';
import { SignAggregatorAgreementDto } from './dto/sign-aggregator-agreement.dto';
import { RevokeAggregatorAgreementDto } from './dto/revoke-aggregator-agreement.dto';

const MAX_SERIALIZABLE_RETRIES = 3;

const AGREEMENT_SELECT = {
  id: true,
  memberId: true,
  version: true,
  status: true,
  documentHash: true,
  signedAt: true,
  supersededAt: true,
  revokedAt: true,
  provenance: true,
  createdAt: true,
  updatedAt: true,
} as const;

function normalizeHash(value: string) {
  return value.toLowerCase();
}

function provenanceObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Prisma.JsonObject) };
  }
  return {};
}

@Injectable()
export class AggregatorAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireGym(gymId?: string) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return gymId;
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
      }
    }

    throw new ConflictException('Falha de concorrencia no cofre de acordos');
  }

  async register(
    dto: CreateAggregatorAgreementDto,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);
    const documentHash = normalizeHash(dto.documentHash);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const member = await tx.aggregatorMember.findFirst({
            where: {
              id: dto.memberId,
              connection: { gymId: tenantId },
            },
            select: {
              id: true,
              connectionId: true,
            },
          });

          if (!member) {
            throw new NotFoundException('Membro agregador nao encontrado');
          }

          const existing = await tx.aggregatorAgreement.findUnique({
            where: {
              memberId_version: {
                memberId: member.id,
                version: dto.version,
              },
            },
            select: AGREEMENT_SELECT,
          });

          if (existing) {
            if (existing.documentHash === documentHash) {
              return existing;
            }
            throw new ConflictException(
              'Versao de acordo ja registrada com outro documento',
            );
          }

          const current = await tx.aggregatorAgreement.findMany({
            where: {
              memberId: member.id,
              status: {
                in: [
                  AggregatorAgreementStatus.REQUIRED,
                  AggregatorAgreementStatus.SIGNED,
                ],
              },
            },
            select: {
              id: true,
              version: true,
              status: true,
              documentHash: true,
            },
          });

          const now = new Date();
          if (current.length > 0) {
            await tx.aggregatorAgreement.updateMany({
              where: {
                id: { in: current.map((agreement) => agreement.id) },
              },
              data: {
                status: AggregatorAgreementStatus.SUPERSEDED,
                supersededAt: now,
              },
            });
          }

          const provenance: Prisma.InputJsonValue = {
            source: dto.source ?? 'IRON',
            registeredAt: now.toISOString(),
            ...(dto.documentRef ? { documentRef: dto.documentRef } : {}),
            ...(dto.locale ? { locale: dto.locale } : {}),
            ...(dto.jurisdiction ? { jurisdiction: dto.jurisdiction } : {}),
          };

          const created = await tx.aggregatorAgreement.create({
            data: {
              memberId: member.id,
              version: dto.version,
              status: AggregatorAgreementStatus.REQUIRED,
              documentHash,
              provenance,
            },
            select: AGREEMENT_SELECT,
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_AGREEMENT_REGISTERED',
              entity: 'AggregatorAgreement',
              entityId: created.id,
              previous: current,
              next: {
                id: created.id,
                memberId: created.memberId,
                version: created.version,
                status: created.status,
                documentHash: created.documentHash,
              },
            },
            tx,
          );

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async sign(
    id: string,
    dto: SignAggregatorAgreementDto,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);
    const documentHash = normalizeHash(dto.documentHash);
    const evidenceHash = normalizeHash(dto.acceptanceEvidenceHash);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const agreement = await tx.aggregatorAgreement.findFirst({
            where: {
              id,
              member: { connection: { gymId: tenantId } },
            },
            include: {
              member: {
                select: {
                  id: true,
                },
              },
            },
          });

          if (!agreement) {
            throw new NotFoundException('Acordo nao encontrado');
          }

          if (agreement.documentHash !== documentHash) {
            throw new ConflictException('Hash do documento nao corresponde ao acordo');
          }

          if (agreement.status === AggregatorAgreementStatus.SIGNED) {
            return tx.aggregatorAgreement.findUniqueOrThrow({
              where: { id: agreement.id },
              select: AGREEMENT_SELECT,
            });
          }

          if (agreement.status !== AggregatorAgreementStatus.REQUIRED) {
            throw new ConflictException('Acordo nao esta disponivel para assinatura');
          }

          const now = new Date();
          const provenance: Prisma.InputJsonValue = {
            ...provenanceObject(agreement.provenance),
            acceptance: {
              accepted: true,
              method: dto.method,
              evidenceHash,
              signerMemberId: agreement.member.id,
              acceptedAt: now.toISOString(),
            },
          } as Prisma.InputJsonValue;

          const updated = await tx.aggregatorAgreement.update({
            where: { id: agreement.id },
            data: {
              status: AggregatorAgreementStatus.SIGNED,
              signedAt: now,
              provenance,
            },
            select: AGREEMENT_SELECT,
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_AGREEMENT_SIGNED',
              entity: 'AggregatorAgreement',
              entityId: updated.id,
              previous: {
                status: agreement.status,
                documentHash: agreement.documentHash,
                signedAt: agreement.signedAt,
              },
              next: {
                status: updated.status,
                documentHash: updated.documentHash,
                signedAt: updated.signedAt,
                acceptanceMethod: dto.method,
                acceptanceEvidenceHash: evidenceHash,
              },
            },
            tx,
          );

          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async revoke(
    id: string,
    dto: RevokeAggregatorAgreementDto,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const agreement = await tx.aggregatorAgreement.findFirst({
            where: {
              id,
              member: { connection: { gymId: tenantId } },
            },
          });

          if (!agreement) {
            throw new NotFoundException('Acordo nao encontrado');
          }

          if (agreement.status === AggregatorAgreementStatus.REVOKED) {
            return tx.aggregatorAgreement.findUniqueOrThrow({
              where: { id: agreement.id },
              select: AGREEMENT_SELECT,
            });
          }

          if (agreement.status === AggregatorAgreementStatus.SUPERSEDED) {
            throw new ConflictException('Acordo historico supersedido nao pode ser revogado');
          }

          const now = new Date();
          const provenance: Prisma.InputJsonValue = {
            ...provenanceObject(agreement.provenance),
            revocation: {
              reason: dto.reason,
              revokedAt: now.toISOString(),
            },
          } as Prisma.InputJsonValue;

          const updated = await tx.aggregatorAgreement.update({
            where: { id: agreement.id },
            data: {
              status: AggregatorAgreementStatus.REVOKED,
              revokedAt: now,
              provenance,
            },
            select: AGREEMENT_SELECT,
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_AGREEMENT_REVOKED',
              entity: 'AggregatorAgreement',
              entityId: updated.id,
              previous: {
                status: agreement.status,
                revokedAt: agreement.revokedAt,
              },
              next: {
                status: updated.status,
                revokedAt: updated.revokedAt,
                reason: dto.reason,
              },
            },
            tx,
          );

          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async findCurrent(memberId: string, gymId?: string) {
    const tenantId = this.requireGym(gymId);
    const agreement = await this.prisma.aggregatorAgreement.findFirst({
      where: {
        memberId,
        member: { connection: { gymId: tenantId } },
        status: {
          in: [
            AggregatorAgreementStatus.REQUIRED,
            AggregatorAgreementStatus.SIGNED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: AGREEMENT_SELECT,
    });

    if (!agreement) {
      throw new NotFoundException('Acordo atual nao encontrado');
    }

    return agreement;
  }

  async findHistory(memberId: string, gymId?: string) {
    const tenantId = this.requireGym(gymId);
    return this.prisma.aggregatorAgreement.findMany({
      where: {
        memberId,
        member: { connection: { gymId: tenantId } },
      },
      orderBy: { createdAt: 'desc' },
      select: AGREEMENT_SELECT,
    });
  }
}
