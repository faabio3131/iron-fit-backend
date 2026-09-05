import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CreatorExerciseContentPlacement,
  CreatorExerciseContentPublicationStatus,
  CreatorRightsConsentStatus,
  CreatorRightsGrantStatus,
  CreatorRightsHolderStatus,
  CreatorRightsScope,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';
import { ContentCatalogContext } from './content-catalog.service';
import { CreateExerciseContentMappingDto } from './dto/exercise-content-publishing.dto';
import { MediaIngestionService } from './media-ingestion.service';
import { CreatorMediaProviderRegistry } from './media/media-provider.registry';

const SERIALIZABLE_ATTEMPTS = 3;
const DELIVERY_MODES = new Set([
  'YOUTUBE_EXTERNAL',
  'IRON_FIRST',
  'TENANT_PRIVATE_FIRST',
  'IRON_ONLY',
  'YOUTUBE_ONLY',
]);

@Injectable()
export class ExerciseContentPublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: TenantProductEntitlementsService,
    private readonly media: MediaIngestionService,
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
    throw new ConflictException('Falha de concorrencia no publishing de conteudo');
  }

  private async assertContext(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
  ) {
    if (context.scope === CreatorRightsScope.GLOBAL) {
      if (context.gymId !== null) {
        throw new BadRequestException('Mapping GLOBAL nao aceita gymId');
      }
      return;
    }

    if (!context.gymId) {
      throw new ForbiddenException('Mapping TENANT exige tenant autenticado');
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
      throw new ConflictException('Rights grant nao esta EFFECTIVE para publishing');
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
          'Publishing exige consentimento ACTIVE e vigente',
        );
      }
    }
    return active;
  }

  private assertContentScope(
    context: ContentCatalogContext,
    content: { scope: CreatorRightsScope; gymId: string | null },
  ) {
    if (content.scope !== context.scope || content.gymId !== context.gymId) {
      throw new ConflictException(
        'Mapping e conteudo devem pertencer ao mesmo escopo governado',
      );
    }
  }

  private async scopedMapping(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
    exerciseId: string,
    mappingId: string,
  ) {
    const mapping = await tx.creatorExerciseContentMapping.findUnique({
      where: { id: mappingId },
      include: { content: true, mediaAsset: true },
    });
    if (!mapping || mapping.exerciseId !== exerciseId) {
      throw new NotFoundException('Mapping Exercise ↔ Content nao encontrado');
    }
    if (mapping.scope !== context.scope || mapping.gymId !== context.gymId) {
      throw new NotFoundException('Mapping nao encontrado no escopo ativo');
    }
    this.assertContentScope(context, mapping.content);
    if (mapping.mediaAsset.contentId !== mapping.contentId) {
      throw new ConflictException('Media Asset nao pertence ao conteudo mapeado');
    }
    return mapping;
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
        'Publishing exige Media Asset com storage CN4 verificado no provider configurado',
      );
    }
    return storage;
  }

  private async resolveProductValue(
    gymId: string,
    userId: string,
    isStudent: boolean,
    featureKey: string,
  ) {
    const resolution = isStudent
      ? await this.entitlements.resolveFeatureForUser(gymId, userId, featureKey)
      : await this.entitlements.resolveFeature(gymId, featureKey);
    return resolution.value;
  }

  private async tenantPublishEntitlements(gymId: string) {
    const [privateFeature, privateLimit] = await Promise.all([
      this.entitlements.resolveFeature(gymId, 'content.tenant_private'),
      this.entitlements.resolveFeature(gymId, 'content.private_items_max'),
    ]);
    return {
      enabled: privateFeature.value === true,
      limit:
        typeof privateLimit.value === 'number' &&
        Number.isInteger(privateLimit.value) &&
        privateLimit.value >= 0
          ? privateLimit.value
          : 0,
    };
  }

  async listMappings(context: ContentCatalogContext, exerciseId: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { id: true },
    });
    if (!exercise) throw new NotFoundException('Exercise nao encontrado');

    return this.prisma.creatorExerciseContentMapping.findMany({
      where: {
        scope: context.scope,
        gymId: context.gymId,
        exerciseId,
      },
      include: { content: true, mediaAsset: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async registerMapping(
    context: ContentCatalogContext,
    exerciseId: string,
    dto: CreateExerciseContentMappingDto,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const exercise = await tx.exercise.findUnique({
        where: { id: exerciseId },
        select: { id: true },
      });
      if (!exercise) throw new NotFoundException('Exercise nao encontrado');

      const content = await tx.creatorContent.findUnique({
        where: { id: dto.contentId },
      });
      if (!content) throw new NotFoundException('CreatorContent nao encontrado');
      this.assertContentScope(context, content);

      const mediaAsset = await tx.creatorMediaAsset.findUnique({
        where: { id: dto.mediaAssetId },
      });
      if (!mediaAsset || mediaAsset.contentId !== content.id) {
        throw new ConflictException('Media Asset nao pertence ao CreatorContent');
      }

      const placement =
        dto.placement === 'PRIMARY'
          ? CreatorExerciseContentPlacement.PRIMARY
          : CreatorExerciseContentPlacement.ALTERNATIVE;
      const existing = await tx.creatorExerciseContentMapping.findFirst({
        where: {
          scope: context.scope,
          gymId: context.gymId,
          exerciseId,
          contentId: content.id,
          mediaAssetId: mediaAsset.id,
          placement,
        },
      });
      if (existing) {
        if (existing.priority === dto.priority) return existing;
        throw new ConflictException(
          'Mapping ja existe com prioridade divergente; alteracao pertence a workflow futuro',
        );
      }

      const fingerprint = this.fingerprint({
        scope: context.scope,
        gymId: context.gymId,
        exerciseId,
        contentId: content.id,
        mediaAssetId: mediaAsset.id,
        placement,
      });
      const mapping = await tx.creatorExerciseContentMapping.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          exerciseId,
          contentId: content.id,
          mediaAssetId: mediaAsset.id,
          placement,
          priority: dto.priority,
          fingerprint,
        },
      });

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'EXERCISE_CONTENT_MAPPING_REGISTERED',
          entity: 'CreatorExerciseContentMapping',
          entityId: mapping.id,
          next: {
            scope: mapping.scope,
            exerciseId: mapping.exerciseId,
            contentId: mapping.contentId,
            mediaAssetId: mapping.mediaAssetId,
            placement: mapping.placement,
            priority: mapping.priority,
          },
        },
        tx,
      );
      return mapping;
    });
  }

  async publishMapping(
    context: ContentCatalogContext,
    exerciseId: string,
    mappingId: string,
    actorUserId?: string,
  ) {
    const tenantCommercial =
      context.scope === CreatorRightsScope.TENANT && context.gymId
        ? await this.tenantPublishEntitlements(context.gymId)
        : null;
    if (tenantCommercial && !tenantCommercial.enabled) {
      throw new ForbiddenException(
        'Plano/configuracao efetiva nao permite content.tenant_private',
      );
    }
    if (tenantCommercial && tenantCommercial.limit < 1) {
      throw new ForbiddenException(
        'content.private_items_max efetivo nao permite publicacao privada',
      );
    }

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const mapping = await this.scopedMapping(
        tx,
        context,
        exerciseId,
        mappingId,
      );
      if (mapping.status === CreatorExerciseContentPublicationStatus.PUBLISHED) {
        return mapping;
      }

      const activeRights = await this.assertEffectiveRights(
        tx,
        context,
        mapping.content.rightsGrantId,
        mapping.content.relationKind,
      );
      const storage = await this.assertVerifiedStorage(tx, mapping.mediaAssetId);

      if (tenantCommercial && context.gymId) {
        const published = await tx.creatorExerciseContentMapping.findMany({
          where: {
            scope: CreatorRightsScope.TENANT,
            gymId: context.gymId,
            status: CreatorExerciseContentPublicationStatus.PUBLISHED,
          },
          select: { contentId: true },
        });
        const contentIds = new Set(published.map((item) => item.contentId));
        if (
          !contentIds.has(mapping.contentId) &&
          contentIds.size >= tenantCommercial.limit
        ) {
          throw new ForbiddenException(
            'Limite content.private_items_max atingido para o tenant',
          );
        }
      }

      if (mapping.placement === CreatorExerciseContentPlacement.PRIMARY) {
        const anotherPrimary = await tx.creatorExerciseContentMapping.findFirst({
          where: {
            scope: context.scope,
            gymId: context.gymId,
            exerciseId,
            placement: CreatorExerciseContentPlacement.PRIMARY,
            status: CreatorExerciseContentPublicationStatus.PUBLISHED,
            id: { not: mapping.id },
          },
          select: { id: true },
        });
        if (anotherPrimary) {
          throw new ConflictException(
            'Ja existe mapping PRIMARY PUBLISHED para este exercicio/escopo',
          );
        }
      }

      const published = await tx.creatorExerciseContentMapping.update({
        where: { id: mapping.id },
        data: {
          status: CreatorExerciseContentPublicationStatus.PUBLISHED,
          publishedAt: new Date(),
          unpublishedAt: null,
          unpublishReason: null,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'EXERCISE_CONTENT_MAPPING_PUBLISHED',
          entity: 'CreatorExerciseContentMapping',
          entityId: published.id,
          next: {
            exerciseId: published.exerciseId,
            contentId: published.contentId,
            mediaAssetId: published.mediaAssetId,
            placement: published.placement,
            effectiveRightsVersion: activeRights.version,
            providerCode: storage.providerCode,
          },
        },
        tx,
      );
      return published;
    });
  }

  async unpublishMapping(
    context: ContentCatalogContext,
    exerciseId: string,
    mappingId: string,
    reason: string,
    actorUserId?: string,
  ) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3) {
      throw new BadRequestException('Unpublish exige motivo auditavel');
    }

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const mapping = await this.scopedMapping(
        tx,
        context,
        exerciseId,
        mappingId,
      );
      if (mapping.status === CreatorExerciseContentPublicationStatus.DRAFT) {
        throw new ConflictException('Mapping DRAFT nunca foi publicado');
      }
      if (mapping.status === CreatorExerciseContentPublicationStatus.UNPUBLISHED) {
        if (mapping.unpublishReason === normalizedReason) return mapping;
        throw new ConflictException('Mapping ja UNPUBLISHED com motivo diferente');
      }

      const unpublished = await tx.creatorExerciseContentMapping.update({
        where: { id: mapping.id },
        data: {
          status: CreatorExerciseContentPublicationStatus.UNPUBLISHED,
          unpublishedAt: new Date(),
          unpublishReason: normalizedReason,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'EXERCISE_CONTENT_MAPPING_UNPUBLISHED',
          entity: 'CreatorExerciseContentMapping',
          entityId: unpublished.id,
          previous: { status: mapping.status },
          next: {
            status: unpublished.status,
            reason: unpublished.unpublishReason,
          },
        },
        tx,
      );
      return unpublished;
    });
  }

  private sortMappings(mappings: any[]) {
    return [...mappings].sort((left, right) => {
      const leftPlacement =
        left.placement === CreatorExerciseContentPlacement.PRIMARY ? 0 : 1;
      const rightPlacement =
        right.placement === CreatorExerciseContentPlacement.PRIMARY ? 0 : 1;
      if (leftPlacement !== rightPlacement) return leftPlacement - rightPlacement;
      if (left.priority !== right.priority) return left.priority - right.priority;
      const leftPublished = left.publishedAt?.getTime?.() ?? 0;
      const rightPublished = right.publishedAt?.getTime?.() ?? 0;
      if (leftPublished !== rightPublished) return rightPublished - leftPublished;
      return left.id.localeCompare(right.id);
    });
  }

  private youtubeReference(videoUrl: string | null) {
    if (!videoUrl) return null;
    try {
      const parsed = new URL(videoUrl);
      const host = parsed.hostname.toLowerCase();
      const allowedHosts = new Set([
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtu.be',
        'youtube-nocookie.com',
        'www.youtube-nocookie.com',
      ]);
      if (parsed.protocol !== 'https:' || !allowedHosts.has(host)) return null;
      return videoUrl;
    } catch {
      return null;
    }
  }

  private async tryManagedMappings(mappings: any[]) {
    for (const mapping of this.sortMappings(mappings)) {
      try {
        const delivery = await this.media.resolveDelivery(
          { scope: mapping.scope, gymId: mapping.gymId },
          mapping.contentId,
          mapping.mediaAssetId,
        );
        return {
          kind: 'MANAGED_CONTENT' as const,
          mappingId: mapping.id,
          contentId: mapping.contentId,
          mediaAssetId: mapping.mediaAssetId,
          contentScope: mapping.scope,
          placement: mapping.placement,
          delivery,
        };
      } catch (error) {
        if (
          error instanceof ConflictException ||
          error instanceof NotFoundException ||
          error instanceof ServiceUnavailableException
        ) {
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  async resolveExerciseContent(
    gymId: string | undefined,
    exerciseId: string,
    userId: string,
    isStudent: boolean,
  ) {
    if (!gymId?.trim()) {
      throw new ForbiddenException('Resolucao de conteudo exige tenant ativo');
    }
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { id: true, name: true, videoUrl: true },
    });
    if (!exercise) throw new NotFoundException('Exercise nao encontrado');

    const [deliveryPolicy, ironManaged, tenantPrivate, externalYoutube] =
      await Promise.all([
        this.resolveProductValue(
          gymId,
          userId,
          isStudent,
          'content.delivery_mode',
        ),
        this.resolveProductValue(
          gymId,
          userId,
          isStudent,
          'content.iron_managed',
        ),
        this.resolveProductValue(
          gymId,
          userId,
          isStudent,
          'content.tenant_private',
        ),
        this.resolveProductValue(
          gymId,
          userId,
          isStudent,
          'content.external_youtube',
        ),
      ]);

    const policyValues = Array.isArray(deliveryPolicy)
      ? deliveryPolicy.filter(
          (value): value is string =>
            typeof value === 'string' && DELIVERY_MODES.has(value),
        )
      : [];
    const mode = policyValues[0] ?? null;
    if (!mode) {
      return {
        kind: 'NONE' as const,
        exerciseId,
        policyMode: null,
        reason: 'DELIVERY_MODE_NOT_EFFECTIVE',
      };
    }

    const [globalMappings, tenantMappings] = await Promise.all([
      ironManaged === true
        ? this.prisma.creatorExerciseContentMapping.findMany({
            where: {
              scope: CreatorRightsScope.GLOBAL,
              gymId: null,
              exerciseId,
              status: CreatorExerciseContentPublicationStatus.PUBLISHED,
            },
          })
        : Promise.resolve([]),
      tenantPrivate === true
        ? this.prisma.creatorExerciseContentMapping.findMany({
            where: {
              scope: CreatorRightsScope.TENANT,
              gymId,
              exerciseId,
              status: CreatorExerciseContentPublicationStatus.PUBLISHED,
            },
          })
        : Promise.resolve([]),
    ]);

    let managedGroups: any[][] = [];
    if (mode === 'IRON_ONLY') managedGroups = [globalMappings];
    if (mode === 'IRON_FIRST') managedGroups = [globalMappings, tenantMappings];
    if (mode === 'TENANT_PRIVATE_FIRST') {
      managedGroups = [tenantMappings, globalMappings];
    }

    for (const group of managedGroups) {
      const managed = await this.tryManagedMappings(group);
      if (managed) {
        return { ...managed, exerciseId, policyMode: mode };
      }
    }

    if (mode !== 'IRON_ONLY' && externalYoutube === true) {
      const externalUrl = this.youtubeReference(exercise.videoUrl);
      if (externalUrl) {
        return {
          kind: 'EXTERNAL_REFERENCE' as const,
          exerciseId,
          policyMode: mode,
          source: 'Exercise.videoUrl',
          url: externalUrl,
        };
      }
    }

    return {
      kind: 'NONE' as const,
      exerciseId,
      policyMode: mode,
      reason: 'NO_ELIGIBLE_CONTENT',
    };
  }
}
