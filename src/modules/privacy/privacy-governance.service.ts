import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataSubjectRequestStatus,
  LegalDocumentStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AcceptLegalDocumentDto,
  CreateDataSubjectRequestDto,
  ReviewDataSubjectRequestDto,
} from './dto/privacy-governance.dto';

@Injectable()
export class PrivacyGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createRequest(
    userId: string,
    dto: CreateDataSubjectRequestDto,
  ) {
    const active = await this.prisma.dataSubjectRequest.findFirst({
      where: {
        userId,
        type: dto.type,
        status: {
          in: [
            DataSubjectRequestStatus.OPEN,
            DataSubjectRequestStatus.IN_REVIEW,
          ],
        },
      },
    });
    if (active) {
      throw new ConflictException(
        'Ja existe solicitacao LGPD ativa deste tipo',
      );
    }

    const request = await this.prisma.dataSubjectRequest.create({
      data: {
        userId,
        type: dto.type,
      },
    });

    await this.audit.record({
      userId,
      action: 'PRIVACY_DSR_CREATED',
      entity: 'DataSubjectRequest',
      entityId: request.id,
      next: {
        type: request.type,
        status: request.status,
        requestedAt: request.requestedAt,
      },
    });

    return request;
  }

  listMine(userId: string) {
    return this.prisma.dataSubjectRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async cancelMine(userId: string, requestId: string) {
    const request = await this.prisma.dataSubjectRequest.findFirst({
      where: { id: requestId, userId },
    });
    if (!request) {
      throw new NotFoundException('Solicitacao LGPD nao encontrada');
    }
    if (request.status !== DataSubjectRequestStatus.OPEN) {
      throw new ConflictException(
        'Somente solicitacao OPEN pode ser cancelada pelo titular',
      );
    }

    const cancelled = await this.prisma.dataSubjectRequest.update({
      where: { id: request.id },
      data: {
        status: DataSubjectRequestStatus.CANCELLED,
        completedAt: new Date(),
        resolutionCode: 'CANCELLED_BY_DATA_SUBJECT',
      },
    });

    await this.audit.record({
      userId,
      action: 'PRIVACY_DSR_CANCELLED',
      entity: 'DataSubjectRequest',
      entityId: request.id,
      previous: { status: request.status },
      next: {
        status: cancelled.status,
        resolutionCode: cancelled.resolutionCode,
      },
    });

    return cancelled;
  }

  async listLegalDocuments() {
    const now = new Date();
    return this.prisma.legalDocument.findMany({
      where: {
        status: LegalDocumentStatus.APPROVED,
        approvedAt: { not: null },
        OR: [
          { effectiveAt: null },
          { effectiveAt: { lte: now } },
        ],
      },
      select: {
        id: true,
        kind: true,
        version: true,
        contentUrl: true,
        contentHash: true,
        effectiveAt: true,
        approvedAt: true,
      },
      orderBy: [{ kind: 'asc' }, { effectiveAt: 'desc' }],
    });
  }

  async acceptLegalDocument(
    userId: string,
    dto: AcceptLegalDocumentDto,
  ) {
    const now = new Date();
    const document = await this.prisma.legalDocument.findFirst({
      where: {
        id: dto.legalDocumentId,
        status: LegalDocumentStatus.APPROVED,
        approvedAt: { not: null },
        OR: [
          { effectiveAt: null },
          { effectiveAt: { lte: now } },
        ],
      },
    });
    if (!document) {
      throw new BadRequestException(
        'Documento legal nao esta aprovado/vigente',
      );
    }

    const acceptance = await this.prisma.legalAcceptance.upsert({
      where: {
        userId_legalDocumentId: {
          userId,
          legalDocumentId: document.id,
        },
      },
      create: {
        userId,
        legalDocumentId: document.id,
      },
      update: {},
      include: {
        legalDocument: {
          select: {
            kind: true,
            version: true,
            contentHash: true,
          },
        },
      },
    });

    await this.audit.record({
      userId,
      action: 'PRIVACY_LEGAL_DOCUMENT_ACCEPTED',
      entity: 'LegalAcceptance',
      entityId: acceptance.id,
      next: {
        legalDocumentId: document.id,
        kind: document.kind,
        version: document.version,
        contentHash: document.contentHash,
        acceptedAt: acceptance.acceptedAt,
      },
    });

    return acceptance;
  }

  listMyAcceptances(userId: string) {
    return this.prisma.legalAcceptance.findMany({
      where: { userId },
      include: {
        legalDocument: {
          select: {
            kind: true,
            version: true,
            contentHash: true,
            contentUrl: true,
            effectiveAt: true,
          },
        },
      },
      orderBy: { acceptedAt: 'desc' },
    });
  }

  listRequestsForOperations() {
    return this.prisma.dataSubjectRequest.findMany({
      orderBy: { requestedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        requestedAt: true,
        operationalDueAt: true,
        reviewedAt: true,
        completedAt: true,
        resolutionCode: true,
      },
    });
  }

  async reviewRequest(
    requestId: string,
    actorUserId: string,
    dto: ReviewDataSubjectRequestDto,
  ) {
    const allowed = new Set<DataSubjectRequestStatus>([
      DataSubjectRequestStatus.IN_REVIEW,
      DataSubjectRequestStatus.FULFILLED,
      DataSubjectRequestStatus.REJECTED,
    ]);
    if (!allowed.has(dto.status)) {
      throw new BadRequestException(
        'Status operacional de DSR invalido',
      );
    }

    const request = await this.prisma.dataSubjectRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Solicitacao LGPD nao encontrada');
    }
    if (
      request.status === DataSubjectRequestStatus.CANCELLED ||
      request.status === DataSubjectRequestStatus.FULFILLED ||
      request.status === DataSubjectRequestStatus.REJECTED
    ) {
      throw new ConflictException(
        'Solicitacao LGPD ja esta em estado terminal',
      );
    }

    const now = new Date();
    const terminal =
      dto.status === DataSubjectRequestStatus.FULFILLED ||
      dto.status === DataSubjectRequestStatus.REJECTED;

    if (
      dto.status === DataSubjectRequestStatus.REJECTED &&
      !dto.resolutionCode?.trim()
    ) {
      throw new BadRequestException(
        'Rejeicao exige resolutionCode operacional',
      );
    }

    const updated = await this.prisma.dataSubjectRequest.update({
      where: { id: request.id },
      data: {
        status: dto.status,
        reviewedAt: request.reviewedAt ?? now,
        completedAt: terminal ? now : null,
        resolutionCode: dto.resolutionCode?.trim() || null,
      },
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'PRIVACY_DSR_REVIEWED',
      entity: 'DataSubjectRequest',
      entityId: request.id,
      previous: {
        status: request.status,
        resolutionCode: request.resolutionCode,
      },
      next: {
        status: updated.status,
        resolutionCode: updated.resolutionCode,
        reviewedAt: updated.reviewedAt,
        completedAt: updated.completedAt,
      },
    });

    return updated;
  }

  async governanceSnapshot() {
    const [
      retentionPolicies,
      subprocessors,
      legalDocuments,
      openRequests,
    ] = await Promise.all([
      this.prisma.dataRetentionPolicy.findMany({
        orderBy: { dataClass: 'asc' },
      }),
      this.prisma.subprocessorRecord.findMany({
        orderBy: { providerCode: 'asc' },
      }),
      this.prisma.legalDocument.findMany({
        orderBy: [{ kind: 'asc' }, { version: 'desc' }],
      }),
      this.prisma.dataSubjectRequest.count({
        where: {
          status: {
            in: [
              DataSubjectRequestStatus.OPEN,
              DataSubjectRequestStatus.IN_REVIEW,
            ],
          },
        },
      }),
    ]);

    return {
      openRequests,
      retentionPolicies,
      subprocessors,
      legalDocuments,
      gate: {
        retentionApproved:
          retentionPolicies.length > 0 &&
          retentionPolicies.every(
            (policy) => policy.status === 'APPROVED',
          ),
        subprocessorsReviewed:
          subprocessors.length > 0 &&
          subprocessors.every(
            (record) => record.status === 'APPROVED',
          ),
        privacyPolicyApproved: legalDocuments.some(
          (document) =>
            document.kind === 'PRIVACY_POLICY' &&
            document.status === 'APPROVED',
        ),
        termsApproved: legalDocuments.some(
          (document) =>
            document.kind === 'TERMS_OF_SERVICE' &&
            document.status === 'APPROVED',
        ),
      },
    };
  }
}
