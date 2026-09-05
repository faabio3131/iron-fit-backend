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
  CreatorMediaIngestionFailure,
  CreatorMediaIngestionStatus,
  CreatorRightsConsentStatus,
  CreatorRightsGrantStatus,
  CreatorRightsHolderStatus,
  CreatorRightsScope,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentCatalogContext } from './content-catalog.service';
import { PrepareMediaIngestionDto } from './dto/media-ingestion.dto';
import { CreatorMediaProviderRegistry } from './media/media-provider.registry';

const SERIALIZABLE_ATTEMPTS = 3;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

@Injectable()
export class MediaIngestionService {
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
    throw new ConflictException('Falha de concorrencia na ingestao de media');
  }

  private async assertContext(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
  ) {
    if (context.scope === CreatorRightsScope.GLOBAL) {
      if (context.gymId !== null) {
        throw new BadRequestException('Media GLOBAL nao aceita gymId');
      }
      return;
    }

    if (!context.gymId) {
      throw new ForbiddenException('Media TENANT exige tenant autenticado');
    }
    const gym = await tx.gym.findFirst({
      where: { id: context.gymId, active: true },
      select: { id: true },
    });
    if (!gym) throw new ForbiddenException('Tenant ativo nao encontrado');
  }

  private assertContentScope(
    context: ContentCatalogContext,
    content: { scope: CreatorRightsScope; gymId: string | null },
  ) {
    if (content.scope !== context.scope || content.gymId !== context.gymId) {
      throw new NotFoundException('Media asset nao encontrado no escopo ativo');
    }
  }

  private async scopedAsset(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
    contentId: string,
    assetId: string,
  ) {
    const asset = await tx.creatorMediaAsset.findUnique({
      where: { id: assetId },
      include: { content: true },
    });
    if (!asset || asset.contentId !== contentId) {
      throw new NotFoundException('Media asset nao encontrado');
    }
    this.assertContentScope(context, asset.content);
    return asset;
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
      throw new ConflictException('Rights grant nao esta EFFECTIVE para media');
    }

    const now = new Date();
    if (active.rightsHolder.status !== CreatorRightsHolderStatus.ACTIVE) {
      throw new ConflictException('Rights holder da media nao esta ACTIVE');
    }
    if (active.validFrom > now) {
      throw new ConflictException('Rights grant da media ainda nao esta vigente');
    }
    if (active.validUntil && active.validUntil <= now) {
      throw new ConflictException('Rights grant da media expirou');
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
          'Rights grant da media exige consentimento ACTIVE e vigente',
        );
      }
    }

    return active;
  }

  private fingerprint(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private logicalObjectKey(
    context: ContentCatalogContext,
    contentId: string,
    assetId: string,
    integritySha256: string,
  ) {
    const tenantSegment = context.gymId ?? 'global';
    return [
      'creator-network',
      context.scope.toLowerCase(),
      tenantSegment,
      contentId,
      assetId,
      integritySha256,
    ].join('/');
  }

  private validateHttpsUrl(url: string, label: string) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('not https');
    } catch {
      throw new ServiceUnavailableException(`${label} retornou URL nao HTTPS`);
    }
  }

  private parsePositiveSize(value: bigint | number | string | undefined) {
    if (value === undefined) return null;
    try {
      const parsed = BigInt(value);
      return parsed > 0n ? parsed : null;
    } catch {
      return null;
    }
  }

  private serializeStorageObject(storage: any) {
    return {
      ...storage,
      sizeBytes: storage.sizeBytes.toString(),
    };
  }

  private async markFailed(
    context: ContentCatalogContext,
    ingestionId: string,
    failureCode: CreatorMediaIngestionFailure,
    actorUserId?: string,
  ) {
    await this.serializable(async (tx) => {
      const ingestion = await tx.creatorMediaIngestion.findUnique({
        where: { id: ingestionId },
        include: { mediaAsset: { include: { content: true } } },
      });
      if (!ingestion) return;
      this.assertContentScope(context, ingestion.mediaAsset.content);
      if (ingestion.status !== CreatorMediaIngestionStatus.PREPARED) return;

      const failed = await tx.creatorMediaIngestion.update({
        where: { id: ingestion.id },
        data: {
          status: CreatorMediaIngestionStatus.FAILED,
          failureCode,
          failedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'MEDIA_INGESTION_FAILED',
          entity: 'CreatorMediaIngestion',
          entityId: failed.id,
          next: {
            mediaAssetId: failed.mediaAssetId,
            providerCode: failed.providerCode,
            failureCode: failed.failureCode,
          },
        },
        tx,
      );
    });
  }

  async prepareIngestion(
    context: ContentCatalogContext,
    contentId: string,
    assetId: string,
    dto: PrepareMediaIngestionDto,
    actorUserId?: string,
  ) {
    const provider = this.providers.getConfigured();
    const providerCode = provider.providerCode.trim().toLowerCase();

    const prepared = await this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const asset = await this.scopedAsset(tx, context, contentId, assetId);
      const activeRights = await this.assertEffectiveRights(
        tx,
        context,
        asset.content.rightsGrantId,
        asset.content.relationKind,
      );

      const storageObject = await tx.creatorMediaStorageObject.findUnique({
        where: {
          mediaAssetId_providerCode: {
            mediaAssetId: asset.id,
            providerCode,
          },
        },
      });
      if (storageObject) {
        return {
          asset,
          activeRightsVersion: activeRights.version,
          existingStorage: storageObject,
          ingestion: null,
        };
      }

      const existing = await tx.creatorMediaIngestion.findUnique({
        where: {
          mediaAssetId_requestKey: {
            mediaAssetId: asset.id,
            requestKey: dto.requestKey,
          },
        },
      });
      if (existing?.status === CreatorMediaIngestionStatus.FAILED) {
        throw new ConflictException(
          'requestKey de ingestao ja terminou em FAILED; use nova requestKey',
        );
      }
      if (existing?.status === CreatorMediaIngestionStatus.VERIFIED) {
        throw new ConflictException(
          'Ingestao ja VERIFIED mas storage object nao foi localizado',
        );
      }
      if (existing) {
        return {
          asset,
          activeRightsVersion: activeRights.version,
          existingStorage: null,
          ingestion: existing,
        };
      }

      const objectKey = this.logicalObjectKey(
        context,
        contentId,
        asset.id,
        asset.integritySha256,
      );
      const fingerprint = this.fingerprint({
        scope: context.scope,
        gymId: context.gymId,
        assetId: asset.id,
        requestKey: dto.requestKey,
      });
      const ingestion = await tx.creatorMediaIngestion.create({
        data: {
          mediaAssetId: asset.id,
          providerCode,
          objectKey,
          requestKey: dto.requestKey,
          fingerprint,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'MEDIA_INGESTION_PREPARED',
          entity: 'CreatorMediaIngestion',
          entityId: ingestion.id,
          next: {
            mediaAssetId: ingestion.mediaAssetId,
            providerCode: ingestion.providerCode,
            requestKey: ingestion.requestKey,
            effectiveRightsVersion: activeRights.version,
          },
        },
        tx,
      );
      return {
        asset,
        activeRightsVersion: activeRights.version,
        existingStorage: null,
        ingestion,
      };
    });

    if (prepared.existingStorage) {
      return {
        alreadyVerified: true,
        storageObject: this.serializeStorageObject(prepared.existingStorage),
        upload: null,
      };
    }

    const ingestion = prepared.ingestion!;
    try {
      const upload = await provider.prepareUpload({
        objectKey: ingestion.objectKey,
        mimeType: prepared.asset.mimeType,
        expectedSha256: prepared.asset.integritySha256,
      });
      this.validateHttpsUrl(upload.url, 'Media provider prepareUpload');
      if (!(upload.expiresAt instanceof Date) || upload.expiresAt <= new Date()) {
        throw new ServiceUnavailableException(
          'Media provider retornou upload expirado/invalido',
        );
      }
      return {
        alreadyVerified: false,
        ingestion,
        upload,
      };
    } catch (error) {
      await this.markFailed(
        context,
        ingestion.id,
        CreatorMediaIngestionFailure.PROVIDER_PREPARE_FAILED,
        actorUserId,
      );
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Media provider indisponivel no prepare');
    }
  }

  async verifyIngestion(
    context: ContentCatalogContext,
    contentId: string,
    assetId: string,
    ingestionId: string,
    actorUserId?: string,
  ) {
    const snapshot = await this.prisma.creatorMediaIngestion.findUnique({
      where: { id: ingestionId },
      include: { mediaAsset: { include: { content: true } } },
    });
    if (!snapshot || snapshot.mediaAssetId !== assetId) {
      throw new NotFoundException('Ingestao de media nao encontrada');
    }
    if (snapshot.mediaAsset.contentId !== contentId) {
      throw new NotFoundException('Ingestao nao pertence ao conteudo informado');
    }
    this.assertContentScope(context, snapshot.mediaAsset.content);

    if (snapshot.status === CreatorMediaIngestionStatus.FAILED) {
      throw new ConflictException('Ingestao FAILED nao pode ser verificada');
    }
    if (snapshot.status === CreatorMediaIngestionStatus.VERIFIED) {
      const storage = await this.prisma.creatorMediaStorageObject.findUnique({
        where: {
          mediaAssetId_providerCode: {
            mediaAssetId: snapshot.mediaAssetId,
            providerCode: snapshot.providerCode,
          },
        },
      });
      if (!storage) {
        throw new ConflictException('Storage object VERIFIED nao encontrado');
      }
      return this.serializeStorageObject(storage);
    }

    const provider = this.providers.getByCode(snapshot.providerCode);
    let inspected;
    try {
      inspected = await provider.inspectObject({ objectKey: snapshot.objectKey });
    } catch {
      await this.markFailed(
        context,
        snapshot.id,
        CreatorMediaIngestionFailure.PROVIDER_INSPECTION_FAILED,
        actorUserId,
      );
      throw new ServiceUnavailableException('Media provider indisponivel na verificacao');
    }

    if (!inspected.exists) {
      await this.markFailed(
        context,
        snapshot.id,
        CreatorMediaIngestionFailure.OBJECT_NOT_FOUND,
        actorUserId,
      );
      throw new ConflictException('Objeto de media nao encontrado no provider');
    }

    const actualSha256 = inspected.sha256?.trim().toLowerCase();
    if (!actualSha256 || !SHA256_PATTERN.test(actualSha256)) {
      await this.markFailed(
        context,
        snapshot.id,
        CreatorMediaIngestionFailure.INTEGRITY_HASH_UNAVAILABLE,
        actorUserId,
      );
      throw new ConflictException(
        'Provider nao comprovou SHA-256 verificavel do objeto',
      );
    }
    if (actualSha256 !== snapshot.mediaAsset.integritySha256.toLowerCase()) {
      await this.markFailed(
        context,
        snapshot.id,
        CreatorMediaIngestionFailure.INTEGRITY_MISMATCH,
        actorUserId,
      );
      throw new ConflictException('SHA-256 do objeto diverge do Media Asset canonico');
    }

    const sizeBytes = this.parsePositiveSize(inspected.sizeBytes);
    if (!sizeBytes) {
      await this.markFailed(
        context,
        snapshot.id,
        CreatorMediaIngestionFailure.INVALID_OBJECT_SIZE,
        actorUserId,
      );
      throw new ConflictException('Provider retornou tamanho de objeto invalido');
    }

    const storage = await this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const asset = await this.scopedAsset(tx, context, contentId, assetId);
      const ingestion = await tx.creatorMediaIngestion.findUnique({
        where: { id: ingestionId },
      });
      if (!ingestion || ingestion.mediaAssetId !== asset.id) {
        throw new NotFoundException('Ingestao nao encontrada na verificacao final');
      }
      if (ingestion.status === CreatorMediaIngestionStatus.FAILED) {
        throw new ConflictException('Ingestao foi marcada FAILED concorrentemente');
      }
      const activeRights = await this.assertEffectiveRights(
        tx,
        context,
        asset.content.rightsGrantId,
        asset.content.relationKind,
      );

      const existing = await tx.creatorMediaStorageObject.findUnique({
        where: {
          mediaAssetId_providerCode: {
            mediaAssetId: asset.id,
            providerCode: ingestion.providerCode,
          },
        },
      });
      if (existing) {
        if (
          existing.objectKey !== ingestion.objectKey ||
          existing.integritySha256 !== actualSha256
        ) {
          throw new ConflictException(
            'Storage object do asset/provider ja existe com identidade divergente',
          );
        }
        if (ingestion.status !== CreatorMediaIngestionStatus.VERIFIED) {
          await tx.creatorMediaIngestion.update({
            where: { id: ingestion.id },
            data: {
              status: CreatorMediaIngestionStatus.VERIFIED,
              verifiedAt: new Date(),
            },
          });
        }
        return existing;
      }

      const created = await tx.creatorMediaStorageObject.create({
        data: {
          mediaAssetId: asset.id,
          sourceIngestionId: ingestion.id,
          providerCode: ingestion.providerCode,
          objectKey: ingestion.objectKey,
          integritySha256: actualSha256,
          sizeBytes,
          etag: inspected.etag?.trim() || null,
        },
      });
      await tx.creatorMediaIngestion.update({
        where: { id: ingestion.id },
        data: {
          status: CreatorMediaIngestionStatus.VERIFIED,
          verifiedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'MEDIA_INGESTION_VERIFIED',
          entity: 'CreatorMediaStorageObject',
          entityId: created.id,
          next: {
            mediaAssetId: created.mediaAssetId,
            providerCode: created.providerCode,
            integritySha256: created.integritySha256,
            sizeBytes: created.sizeBytes.toString(),
            effectiveRightsVersion: activeRights.version,
          },
        },
        tx,
      );
      return created;
    });

    return this.serializeStorageObject(storage);
  }

  async resolveDelivery(
    context: ContentCatalogContext,
    contentId: string,
    assetId: string,
  ) {
    const provider = this.providers.getConfigured();
    const providerCode = provider.providerCode.trim().toLowerCase();

    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const asset = await this.scopedAsset(tx, context, contentId, assetId);
        await this.assertEffectiveRights(
          tx,
          context,
          asset.content.rightsGrantId,
          asset.content.relationKind,
        );
        const storage = await tx.creatorMediaStorageObject.findUnique({
          where: {
            mediaAssetId_providerCode: {
              mediaAssetId: asset.id,
              providerCode,
            },
          },
        });
        if (!storage) {
          throw new NotFoundException(
            'Media asset nao possui storage verificado no provider configurado',
          );
        }
        return storage;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const delivery = await provider.resolveDelivery({
      objectKey: snapshot.objectKey,
    });
    this.validateHttpsUrl(delivery.url, 'Media provider resolveDelivery');
    if (delivery.expiresAt && delivery.expiresAt <= new Date()) {
      throw new ServiceUnavailableException(
        'Media provider retornou delivery expirado',
      );
    }
    return {
      url: delivery.url,
      expiresAt: delivery.expiresAt ?? null,
      providerCode: snapshot.providerCode,
      mediaAssetId: snapshot.mediaAssetId,
    };
  }
}
