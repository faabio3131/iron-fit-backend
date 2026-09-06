import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatorContentLifecycleStatus,
  CreatorContentModerationDecision,
  CreatorContentQualityVerdict,
  CreatorContentVersionStatus,
  CreatorExerciseContentPublicationStatus,
  CreatorRightsConsentStatus,
  CreatorRightsGrantStatus,
  CreatorRightsHolderStatus,
  CreatorRightsScope,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentCatalogContext } from './content-catalog.service';
import {
  ContentLifecycleReasonDto,
  CreateContentVersionDto,
  ReviewContentVersionDto,
} from './dto/content-lifecycle.dto';
import { CreatorMediaProviderRegistry } from './media/media-provider.registry';

const SERIALIZABLE_ATTEMPTS = 3;

@Injectable()
export class ContentLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: CreatorMediaProviderRegistry,
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
    throw new ConflictException('Falha de concorrencia no lifecycle de conteudo');
  }

  private async assertContext(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
  ) {
    if (context.scope === CreatorRightsScope.GLOBAL) {
      if (context.gymId !== null) {
        throw new BadRequestException('Lifecycle GLOBAL nao aceita gymId');
      }
      return;
    }

    if (!context.gymId) {
      throw new ForbiddenException('Lifecycle TENANT exige tenant autenticado');
    }
    const gym = await tx.gym.findFirst({
      where: { id: context.gymId, active: true },
      select: { id: true },
    });
    if (!gym) throw new ForbiddenException('Tenant ativo nao encontrado');
  }

  private fingerprint(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async scopedContent(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
    contentId: string,
  ) {
    const content = await tx.creatorContent.findUnique({
      where: { id: contentId },
    });
    if (!content) throw new NotFoundException('CreatorContent nao encontrado');
    if (content.scope !== context.scope || content.gymId !== context.gymId) {
      throw new NotFoundException('CreatorContent nao encontrado no escopo ativo');
    }
    return content;
  }

  private async assertEffectiveRights(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
    rightsGrantId: string,
    relationKind: any,
  ) {
    const grant = await tx.creatorRightsGrant.findFirst({
      where: {
        id: rightsGrantId,
        scope: context.scope,
        gymId: context.gymId,
        relationKind,
      },
      include: {
        versions: {
          where: { status: CreatorRightsGrantStatus.ACTIVE },
          take: 1,
          include: { rightsHolder: true, consents: true },
        },
      },
    });
    const active = grant?.versions[0];
    if (!grant || !active) {
      throw new ConflictException('Rights grant nao esta EFFECTIVE para lifecycle');
    }

    const now = new Date();
    if (active.rightsHolder.status !== CreatorRightsHolderStatus.ACTIVE) {
      throw new ConflictException('Rights holder do conteudo nao esta ACTIVE');
    }
    if (active.validFrom > now) {
      throw new ConflictException('Rights grant ainda nao esta vigente');
    }
    if (active.validUntil && active.validUntil <= now) {
      throw new ConflictException('Rights grant do conteudo expirou');
    }
    if (active.requiresCreatorConsent) {
      const validConsent = active.consents.some(
        (consent) =>
          consent.status === CreatorRightsConsentStatus.ACTIVE &&
          consent.validFrom <= now &&
          (!consent.validUntil || consent.validUntil > now),
      );
      if (!validConsent) {
        throw new ConflictException(
          'Lifecycle exige consentimento ACTIVE e vigente',
        );
      }
    }
    return active;
  }

  private async assertVerifiedStorage(
    tx: Prisma.TransactionClient,
    mediaAssetId: string,
  ) {
    const provider = this.providers.getConfigured();
    const providerCode = provider.providerCode.trim().toLowerCase();
    const storage = await tx.creatorMediaStorageObject.findUnique({
      where: {
        mediaAssetId_providerCode: { mediaAssetId, providerCode },
      },
    });
    if (!storage) {
      throw new ConflictException(
        'Certificacao exige Media Asset com storage CN4 verificado no provider configurado',
      );
    }
    return storage;
  }

  private quality(dto: ReviewContentVersionDto) {
    const decision =
      dto.decision === 'APPROVE'
        ? CreatorContentModerationDecision.APPROVE
        : CreatorContentModerationDecision.REJECT;
    const technicalQuality =
      dto.technicalQuality === 'PASS'
        ? CreatorContentQualityVerdict.PASS
        : CreatorContentQualityVerdict.FAIL;
    const instructionalQuality =
      dto.instructionalQuality === 'PASS'
        ? CreatorContentQualityVerdict.PASS
        : CreatorContentQualityVerdict.FAIL;
    const safetyQuality =
      dto.safetyQuality === 'PASS'
        ? CreatorContentQualityVerdict.PASS
        : CreatorContentQualityVerdict.FAIL;
    const accessibilityQuality =
      dto.accessibilityQuality === 'PASS'
        ? CreatorContentQualityVerdict.PASS
        : dto.accessibilityQuality === 'FAIL'
          ? CreatorContentQualityVerdict.FAIL
          : CreatorContentQualityVerdict.NOT_APPLICABLE;

    if (decision === CreatorContentModerationDecision.APPROVE) {
      const approvalValid =
        technicalQuality === CreatorContentQualityVerdict.PASS &&
        instructionalQuality === CreatorContentQualityVerdict.PASS &&
        safetyQuality === CreatorContentQualityVerdict.PASS &&
        accessibilityQuality !== CreatorContentQualityVerdict.FAIL;
      if (!approvalValid) {
        throw new BadRequestException(
          'APPROVE exige technical, instructional e safety PASS; accessibility deve ser PASS ou NOT_APPLICABLE',
        );
      }
    } else {
      const rejectionValid = [
        technicalQuality,
        instructionalQuality,
        safetyQuality,
        accessibilityQuality,
      ].includes(CreatorContentQualityVerdict.FAIL);
      if (!rejectionValid) {
        throw new BadRequestException(
          'REJECT exige pelo menos um veredito de qualidade FAIL',
        );
      }
    }

    return {
      decision,
      technicalQuality,
      instructionalQuality,
      safetyQuality,
      accessibilityQuality,
      notes: dto.notes?.trim() || null,
    };
  }

  private async approvedVersion(
    tx: Prisma.TransactionClient,
    contentId: string,
  ) {
    const version = await tx.creatorContentVersion.findFirst({
      where: {
        contentId,
        status: CreatorContentVersionStatus.APPROVED,
      },
      include: { mediaAsset: true },
      orderBy: { version: 'desc' },
    });
    if (!version) {
      throw new ConflictException('Conteudo nao possui versao APPROVED');
    }
    return version;
  }

  private async assertCertification(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
    content: {
      id: string;
      rightsGrantId: string;
      relationKind: any;
    },
  ) {
    const version = await this.approvedVersion(tx, content.id);
    const rights = await this.assertEffectiveRights(
      tx,
      context,
      content.rightsGrantId,
      content.relationKind,
    );
    const storage = await this.assertVerifiedStorage(tx, version.mediaAssetId);
    return { version, rights, storage };
  }

  private async unpublishMappings(
    tx: Prisma.TransactionClient,
    contentId: string,
    reason: string,
    exceptMediaAssetId?: string,
  ) {
    return tx.creatorExerciseContentMapping.updateMany({
      where: {
        contentId,
        status: CreatorExerciseContentPublicationStatus.PUBLISHED,
        ...(exceptMediaAssetId
          ? { mediaAssetId: { not: exceptMediaAssetId } }
          : {}),
      },
      data: {
        status: CreatorExerciseContentPublicationStatus.UNPUBLISHED,
        unpublishedAt: new Date(),
        unpublishReason: reason,
      },
    });
  }

  async findOne(context: ContentCatalogContext, contentId: string) {
    const content = await this.prisma.creatorContent.findFirst({
      where: {
        id: contentId,
        scope: context.scope,
        gymId: context.gymId,
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: { mediaAsset: true, review: true },
        },
      },
    });
    if (!content) throw new NotFoundException('CreatorContent nao encontrado');
    return content;
  }

  async createVersion(
    context: ContentCatalogContext,
    contentId: string,
    dto: CreateContentVersionDto,
    actorUserId?: string,
  ) {
    const editorialTitle = dto.editorialTitle.trim();
    if (!editorialTitle) {
      throw new BadRequestException('editorialTitle nao pode ser vazio');
    }

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await this.scopedContent(tx, context, contentId);
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.RETIRED) {
        throw new ConflictException('Conteudo RETIRED e terminal');
      }

      const existingDraft = await tx.creatorContentVersion.findFirst({
        where: {
          contentId,
          status: CreatorContentVersionStatus.DRAFT,
        },
        select: { id: true },
      });
      if (existingDraft) {
        throw new ConflictException(
          'Conteudo ja possui uma versao DRAFT aguardando review',
        );
      }

      const mediaAsset = await tx.creatorMediaAsset.findUnique({
        where: { id: dto.mediaAssetId },
      });
      if (!mediaAsset || mediaAsset.contentId !== contentId) {
        throw new ConflictException('Media Asset nao pertence ao CreatorContent');
      }

      const latest = await tx.creatorContentVersion.findFirst({
        where: { contentId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const versionNumber = (latest?.version ?? 0) + 1;
      const editorialDescription = dto.editorialDescription?.trim() || null;
      const fingerprint = this.fingerprint({
        contentId,
        version: versionNumber,
        mediaAssetId: mediaAsset.id,
        editorialTitle,
        editorialDescription,
      });

      const version = await tx.creatorContentVersion.create({
        data: {
          contentId,
          version: versionNumber,
          mediaAssetId: mediaAsset.id,
          editorialTitle,
          editorialDescription,
          fingerprint,
        },
      });

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CONTENT_VERSION_CREATED',
          entity: 'CreatorContentVersion',
          entityId: version.id,
          next: {
            contentId,
            version: version.version,
            mediaAssetId: version.mediaAssetId,
            status: version.status,
          },
        },
        tx,
      );
      return version;
    });
  }

  async reviewVersion(
    context: ContentCatalogContext,
    contentId: string,
    versionId: string,
    dto: ReviewContentVersionDto,
    actorUserId: string,
  ) {
    const quality = this.quality(dto);

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await this.scopedContent(tx, context, contentId);
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.RETIRED) {
        throw new ConflictException('Conteudo RETIRED nao aceita novo review');
      }

      const version = await tx.creatorContentVersion.findFirst({
        where: { id: versionId, contentId },
        include: { review: true, mediaAsset: true },
      });
      if (!version) throw new NotFoundException('Versao de conteudo nao encontrada');

      if (version.status !== CreatorContentVersionStatus.DRAFT) {
        const existing = version.review;
        const expectedStatuses: CreatorContentVersionStatus[] =
          quality.decision === CreatorContentModerationDecision.APPROVE
            ? [
                CreatorContentVersionStatus.APPROVED,
                CreatorContentVersionStatus.SUPERSEDED,
              ]
            : [CreatorContentVersionStatus.REJECTED];
        if (
          existing &&
          expectedStatuses.includes(version.status) &&
          existing.decision === quality.decision &&
          existing.technicalQuality === quality.technicalQuality &&
          existing.instructionalQuality === quality.instructionalQuality &&
          existing.safetyQuality === quality.safetyQuality &&
          existing.accessibilityQuality === quality.accessibilityQuality &&
          existing.notes === quality.notes &&
          existing.reviewerUserId === actorUserId
        ) {
          return { version, review: existing, idempotent: true };
        }
        throw new ConflictException('Review de versao e imutavel');
      }

      if (quality.decision === CreatorContentModerationDecision.APPROVE) {
        await this.assertVerifiedStorage(tx, version.mediaAssetId);
      }

      const reviewedAt = new Date();
      let invalidatedMappings = 0;
      let nextStatus: CreatorContentVersionStatus;

      if (quality.decision === CreatorContentModerationDecision.APPROVE) {
        await tx.creatorContentVersion.updateMany({
          where: {
            contentId,
            status: CreatorContentVersionStatus.APPROVED,
            id: { not: version.id },
          },
          data: { status: CreatorContentVersionStatus.SUPERSEDED },
        });
        nextStatus = CreatorContentVersionStatus.APPROVED;
      } else {
        nextStatus = CreatorContentVersionStatus.REJECTED;
      }

      const reviewedVersion = await tx.creatorContentVersion.update({
        where: { id: version.id },
        data: {
          status: nextStatus,
          reviewedAt,
        },
      });
      const review = await tx.creatorContentReview.create({
        data: {
          contentVersionId: version.id,
          decision: quality.decision,
          technicalQuality: quality.technicalQuality,
          instructionalQuality: quality.instructionalQuality,
          safetyQuality: quality.safetyQuality,
          accessibilityQuality: quality.accessibilityQuality,
          notes: quality.notes,
          reviewerUserId: actorUserId,
          reviewedAt,
        },
      });

      if (
        quality.decision === CreatorContentModerationDecision.APPROVE &&
        content.lifecycleStatus === CreatorContentLifecycleStatus.ACTIVE
      ) {
        const invalidated = await this.unpublishMappings(
          tx,
          contentId,
          'CN6_VERSION_SUPERSEDED',
          version.mediaAssetId,
        );
        invalidatedMappings = invalidated.count;
      }

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId,
          action: 'CONTENT_VERSION_REVIEWED',
          entity: 'CreatorContentVersion',
          entityId: reviewedVersion.id,
          previous: { status: version.status },
          next: {
            status: reviewedVersion.status,
            decision: review.decision,
            technicalQuality: review.technicalQuality,
            instructionalQuality: review.instructionalQuality,
            safetyQuality: review.safetyQuality,
            accessibilityQuality: review.accessibilityQuality,
            invalidatedMappings,
          },
        },
        tx,
      );

      return { version: reviewedVersion, review, invalidatedMappings };
    });
  }

  async activate(
    context: ContentCatalogContext,
    contentId: string,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await this.scopedContent(tx, context, contentId);
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.ACTIVE) {
        return content;
      }
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.SUSPENDED) {
        throw new ConflictException('Conteudo SUSPENDED exige reativacao explicita');
      }
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.RETIRED) {
        throw new ConflictException('Conteudo RETIRED e terminal');
      }

      const certification = await this.assertCertification(tx, context, content);
      const activated = await tx.creatorContent.update({
        where: { id: contentId },
        data: {
          lifecycleStatus: CreatorContentLifecycleStatus.ACTIVE,
          activatedAt: new Date(),
          suspendedAt: null,
          retiredAt: null,
          lifecycleReason: null,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CONTENT_LIFECYCLE_ACTIVATED',
          entity: 'CreatorContent',
          entityId: contentId,
          previous: { lifecycleStatus: content.lifecycleStatus },
          next: {
            lifecycleStatus: activated.lifecycleStatus,
            approvedVersion: certification.version.version,
            mediaAssetId: certification.version.mediaAssetId,
            effectiveRightsVersion: certification.rights.version,
            providerCode: certification.storage.providerCode,
          },
        },
        tx,
      );
      return activated;
    });
  }

  async suspend(
    context: ContentCatalogContext,
    contentId: string,
    dto: ContentLifecycleReasonDto,
    actorUserId?: string,
  ) {
    const reason = dto.reason.trim();
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await this.scopedContent(tx, context, contentId);
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.RETIRED) {
        throw new ConflictException('Conteudo RETIRED e terminal');
      }
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.DRAFT) {
        throw new ConflictException('Conteudo DRAFT nao pode ser suspenso');
      }
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.SUSPENDED) {
        if (content.lifecycleReason === reason) return content;
        throw new ConflictException('Conteudo ja SUSPENDED com motivo diferente');
      }

      const invalidated = await this.unpublishMappings(
        tx,
        contentId,
        'CN6_CONTENT_SUSPENDED',
      );
      const suspended = await tx.creatorContent.update({
        where: { id: contentId },
        data: {
          lifecycleStatus: CreatorContentLifecycleStatus.SUSPENDED,
          suspendedAt: new Date(),
          lifecycleReason: reason,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CONTENT_LIFECYCLE_SUSPENDED',
          entity: 'CreatorContent',
          entityId: contentId,
          previous: { lifecycleStatus: content.lifecycleStatus },
          next: {
            lifecycleStatus: suspended.lifecycleStatus,
            reason,
            invalidatedMappings: invalidated.count,
          },
        },
        tx,
      );
      return suspended;
    });
  }

  async reactivate(
    context: ContentCatalogContext,
    contentId: string,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await this.scopedContent(tx, context, contentId);
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.ACTIVE) {
        return content;
      }
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.DRAFT) {
        throw new ConflictException('Conteudo DRAFT exige activate, nao reactivate');
      }
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.RETIRED) {
        throw new ConflictException('Conteudo RETIRED e terminal');
      }

      const certification = await this.assertCertification(tx, context, content);
      const reactivated = await tx.creatorContent.update({
        where: { id: contentId },
        data: {
          lifecycleStatus: CreatorContentLifecycleStatus.ACTIVE,
          activatedAt: new Date(),
          suspendedAt: null,
          lifecycleReason: null,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CONTENT_LIFECYCLE_REACTIVATED',
          entity: 'CreatorContent',
          entityId: contentId,
          previous: {
            lifecycleStatus: content.lifecycleStatus,
            reason: content.lifecycleReason,
          },
          next: {
            lifecycleStatus: reactivated.lifecycleStatus,
            approvedVersion: certification.version.version,
            mediaAssetId: certification.version.mediaAssetId,
            effectiveRightsVersion: certification.rights.version,
            providerCode: certification.storage.providerCode,
            mappingsRepublished: 0,
          },
        },
        tx,
      );
      return reactivated;
    });
  }

  async retire(
    context: ContentCatalogContext,
    contentId: string,
    dto: ContentLifecycleReasonDto,
    actorUserId?: string,
  ) {
    const reason = dto.reason.trim();
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await this.scopedContent(tx, context, contentId);
      if (content.lifecycleStatus === CreatorContentLifecycleStatus.RETIRED) {
        if (content.lifecycleReason === reason) return content;
        throw new ConflictException('Conteudo RETIRED e terminal');
      }

      const invalidated = await this.unpublishMappings(
        tx,
        contentId,
        'CN6_CONTENT_RETIRED',
      );
      const retired = await tx.creatorContent.update({
        where: { id: contentId },
        data: {
          lifecycleStatus: CreatorContentLifecycleStatus.RETIRED,
          retiredAt: new Date(),
          lifecycleReason: reason,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CONTENT_LIFECYCLE_RETIRED',
          entity: 'CreatorContent',
          entityId: contentId,
          previous: { lifecycleStatus: content.lifecycleStatus },
          next: {
            lifecycleStatus: retired.lifecycleStatus,
            reason,
            invalidatedMappings: invalidated.count,
          },
        },
        tx,
      );
      return retired;
    });
  }
}
