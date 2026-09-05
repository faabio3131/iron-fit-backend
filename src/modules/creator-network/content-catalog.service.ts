import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatorManagedRelationKind,
  CreatorRightsConsentStatus,
  CreatorRightsGrantStatus,
  CreatorRightsHolderStatus,
  CreatorRightsScope,
  CreatorStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCanonicalContentDto,
  RegisterMediaAssetDto,
} from './dto/content-catalog.dto';

const SERIALIZABLE_ATTEMPTS = 3;
const CANONICAL_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;

export interface ContentCatalogContext {
  scope: CreatorRightsScope;
  gymId: string | null;
}

@Injectable()
export class ContentCatalogService {
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
    throw new ConflictException('Falha de concorrencia ao governar Content Catalog');
  }

  private async assertContext(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
  ) {
    if (context.scope === CreatorRightsScope.GLOBAL) {
      if (context.gymId !== null) {
        throw new BadRequestException('Content scope GLOBAL nao aceita gymId');
      }
      return;
    }

    if (!context.gymId) {
      throw new ForbiddenException('Content scope TENANT exige tenant autenticado');
    }

    const gym = await tx.gym.findFirst({
      where: { id: context.gymId, active: true },
      select: { id: true },
    });
    if (!gym) throw new ForbiddenException('Tenant ativo nao encontrado');
  }

  private assertRelationScope(
    context: ContentCatalogContext,
    relationKind: CreatorManagedRelationKind,
  ) {
    if (
      context.scope === CreatorRightsScope.TENANT &&
      relationKind !== CreatorManagedRelationKind.TENANT_OWNED
    ) {
      throw new BadRequestException(
        'Content Catalog TENANT deve usar relationKind TENANT_OWNED',
      );
    }
    if (
      context.scope === CreatorRightsScope.GLOBAL &&
      relationKind === CreatorManagedRelationKind.TENANT_OWNED
    ) {
      throw new BadRequestException(
        'TENANT_OWNED nao pode ser catalogado no escopo GLOBAL',
      );
    }
  }

  private normalizeText(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeCanonicalKey(value: string) {
    const key = value.trim().toLowerCase();
    if (!CANONICAL_KEY_PATTERN.test(key)) {
      throw new BadRequestException('canonicalKey invalida');
    }
    return key;
  }

  private fingerprint(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async assertEffectiveRights(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
    rightsGrantId: string,
    relationKind: CreatorManagedRelationKind,
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
    if (!grant) {
      throw new NotFoundException(
        'Rights grant compativel com o escopo e relationKind nao encontrado',
      );
    }

    const active = grant.versions[0];
    if (!active) {
      throw new ConflictException('Rights grant nao esta EFFECTIVE para catalogacao');
    }

    const now = new Date();
    if (active.rightsHolder.status !== CreatorRightsHolderStatus.ACTIVE) {
      throw new ConflictException('Rights holder do conteudo nao esta ACTIVE');
    }
    if (active.validFrom > now) {
      throw new ConflictException('Rights grant do conteudo ainda nao esta vigente');
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
          'Rights grant do conteudo exige consentimento ACTIVE e vigente',
        );
      }
    }

    return { grant, activeVersion: active };
  }

  private async scopedContent(
    tx: Prisma.TransactionClient,
    context: ContentCatalogContext,
    contentId: string,
  ) {
    const content = await tx.creatorContent.findFirst({
      where: {
        id: contentId,
        scope: context.scope,
        gymId: context.gymId,
      },
      include: {
        creator: true,
        rightsGrant: true,
        mediaAssets: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!content) throw new NotFoundException('Conteudo canonico nao encontrado');
    return content;
  }

  async findAll(context: ContentCatalogContext) {
    if (context.scope === CreatorRightsScope.TENANT && !context.gymId) {
      throw new ForbiddenException('Tenant autenticado obrigatorio');
    }
    return this.prisma.creatorContent.findMany({
      where: { scope: context.scope, gymId: context.gymId },
      include: {
        creator: true,
        rightsGrant: true,
        mediaAssets: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(context: ContentCatalogContext, contentId: string) {
    if (context.scope === CreatorRightsScope.TENANT && !context.gymId) {
      throw new ForbiddenException('Tenant autenticado obrigatorio');
    }
    const content = await this.prisma.creatorContent.findFirst({
      where: {
        id: contentId,
        scope: context.scope,
        gymId: context.gymId,
      },
      include: {
        creator: true,
        rightsGrant: true,
        mediaAssets: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!content) throw new NotFoundException('Conteudo canonico nao encontrado');
    return content;
  }

  async create(
    context: ContentCatalogContext,
    dto: CreateCanonicalContentDto,
    actorUserId?: string,
  ) {
    this.assertRelationScope(context, dto.relationKind);
    const canonicalKey = this.normalizeCanonicalKey(dto.canonicalKey);
    const title = this.normalizeText(dto.title);
    const description = dto.description?.trim() || null;
    const fingerprint = this.fingerprint({
      scope: context.scope,
      gymId: context.gymId,
      canonicalKey,
    });

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);

      if (dto.creatorId) {
        const creator = await tx.creator.findUnique({ where: { id: dto.creatorId } });
        if (!creator) throw new NotFoundException('Creator nao encontrado');
        if (creator.status !== CreatorStatus.ACTIVE) {
          throw new ConflictException(
            'Novo conteudo associado a creator exige Creator ACTIVE',
          );
        }
      }

      const { activeVersion } = await this.assertEffectiveRights(
        tx,
        context,
        dto.rightsGrantId,
        dto.relationKind,
      );

      const existing = await tx.creatorContent.findUnique({
        where: { fingerprint },
        include: {
          creator: true,
          rightsGrant: true,
          mediaAssets: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (existing) {
        const sameDefinition =
          existing.title === title &&
          existing.description === description &&
          existing.relationKind === dto.relationKind &&
          existing.creatorId === (dto.creatorId ?? null) &&
          existing.rightsGrantId === dto.rightsGrantId;
        if (!sameDefinition) {
          throw new ConflictException(
            'canonicalKey ja existe no escopo com definicao diferente',
          );
        }
        return existing;
      }

      const content = await tx.creatorContent.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          canonicalKey,
          title,
          description,
          relationKind: dto.relationKind,
          creatorId: dto.creatorId ?? null,
          rightsGrantId: dto.rightsGrantId,
          fingerprint,
        },
        include: {
          creator: true,
          rightsGrant: true,
          mediaAssets: true,
        },
      });

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CONTENT_CATALOG_ITEM_REGISTERED',
          entity: 'CreatorContent',
          entityId: content.id,
          next: {
            scope: content.scope,
            canonicalKey: content.canonicalKey,
            relationKind: content.relationKind,
            creatorId: content.creatorId,
            rightsGrantId: content.rightsGrantId,
            effectiveRightsVersion: activeVersion.version,
            fingerprint: content.fingerprint,
          },
        },
        tx,
      );

      return content;
    });
  }

  async registerMediaAsset(
    context: ContentCatalogContext,
    contentId: string,
    dto: RegisterMediaAssetDto,
    actorUserId?: string,
  ) {
    const integritySha256 = dto.integritySha256.toLowerCase();
    const mimeType = dto.mimeType.trim().toLowerCase();
    const languageCode = dto.languageCode?.trim() || null;

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await this.scopedContent(tx, context, contentId);
      const { activeVersion } = await this.assertEffectiveRights(
        tx,
        context,
        content.rightsGrantId,
        content.relationKind,
      );

      const existing = await tx.creatorMediaAsset.findUnique({
        where: {
          contentId_integritySha256: {
            contentId: content.id,
            integritySha256,
          },
        },
      });
      if (existing) {
        const sameDefinition =
          existing.kind === dto.kind &&
          existing.mimeType === mimeType &&
          existing.durationMs === (dto.durationMs ?? null) &&
          existing.width === (dto.width ?? null) &&
          existing.height === (dto.height ?? null) &&
          existing.languageCode === languageCode;
        if (!sameDefinition) {
          throw new ConflictException(
            'Media asset com mesmo hash ja existe com metadados diferentes',
          );
        }
        return existing;
      }

      const asset = await tx.creatorMediaAsset.create({
        data: {
          contentId: content.id,
          kind: dto.kind,
          integritySha256,
          mimeType,
          durationMs: dto.durationMs ?? null,
          width: dto.width ?? null,
          height: dto.height ?? null,
          languageCode,
        },
      });

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CONTENT_MEDIA_ASSET_REGISTERED',
          entity: 'CreatorMediaAsset',
          entityId: asset.id,
          next: {
            contentId: asset.contentId,
            kind: asset.kind,
            integritySha256: asset.integritySha256,
            mimeType: asset.mimeType,
            effectiveRightsVersion: activeVersion.version,
          },
        },
        tx,
      );

      return asset;
    });
  }
}
