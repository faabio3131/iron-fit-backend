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
  CreatorContentVersionStatus,
  CreatorExerciseContentPublicationStatus,
  CreatorRightsConsentStatus,
  CreatorRightsGrantStatus,
  CreatorRightsHolderStatus,
  CreatorRightsScope,
  CreatorUsageDeliveryKind,
  CreatorUsageEventType,
  CreatorUsageObservationSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RecordContentEngagementDto } from './dto/content-usage.dto';
import { ExerciseContentPublishingService } from './exercise-content-publishing.service';

const SERIALIZABLE_ATTEMPTS = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIENCE_ROLES = new Set(['OWNER', 'MANAGER', 'TRAINER', 'STUDENT']);

type AudienceRole = 'OWNER' | 'MANAGER' | 'TRAINER' | 'STUDENT';

@Injectable()
export class ContentUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publishing: ExerciseContentPublishingService,
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
    throw new ConflictException('Falha de concorrencia no usage metering');
  }

  private fingerprint(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private normalizeUsageKey(value: string | undefined) {
    const usageKey = value?.trim().toLowerCase();
    if (!usageKey || !UUID_PATTERN.test(usageKey)) {
      throw new BadRequestException(
        'x-iron-usage-key deve ser UUID valido para idempotencia do metering',
      );
    }
    return usageKey;
  }

  private assertAudienceRole(role: string): asserts role is AudienceRole {
    if (!AUDIENCE_ROLES.has(role)) {
      throw new ForbiddenException('Papel autenticado nao permitido no usage metering');
    }
  }

  private effectiveRights(content: any) {
    const active = content.rightsGrant?.versions?.[0];
    if (!active) {
      throw new ConflictException('Rights grant nao esta EFFECTIVE no metering');
    }
    const now = new Date();
    if (active.status !== CreatorRightsGrantStatus.ACTIVE) {
      throw new ConflictException('Rights grant nao esta ACTIVE no metering');
    }
    if (active.rightsHolder.status !== CreatorRightsHolderStatus.ACTIVE) {
      throw new ConflictException('Rights holder nao esta ACTIVE no metering');
    }
    if (active.validFrom > now || (active.validUntil && active.validUntil <= now)) {
      throw new ConflictException('Rights grant fora da janela vigente no metering');
    }
    if (active.requiresCreatorConsent) {
      const consent = active.consents.some(
        (item: any) =>
          item.status === CreatorRightsConsentStatus.ACTIVE &&
          item.validFrom <= now &&
          (!item.validUntil || item.validUntil > now),
      );
      if (!consent) {
        throw new ConflictException('Consentimento vigente ausente no metering');
      }
    }
    return active;
  }

  private async captureManagedAttribution(
    tx: Prisma.TransactionClient,
    gymId: string,
    exerciseId: string,
    resolution: any,
  ) {
    const mapping = await tx.creatorExerciseContentMapping.findFirst({
      where: {
        id: resolution.mappingId,
        exerciseId,
        contentId: resolution.contentId,
        mediaAssetId: resolution.mediaAssetId,
        status: CreatorExerciseContentPublicationStatus.PUBLISHED,
      },
    });
    if (!mapping) {
      throw new ConflictException('Mapping deixou de estar PUBLISHED antes do metering');
    }
    if (
      mapping.scope === CreatorRightsScope.TENANT &&
      mapping.gymId !== gymId
    ) {
      throw new ForbiddenException('Mapping TENANT nao pertence ao tenant autenticado');
    }
    if (
      mapping.scope === CreatorRightsScope.GLOBAL &&
      mapping.gymId !== null
    ) {
      throw new ConflictException('Mapping GLOBAL possui escopo fisico invalido');
    }

    const content = await tx.creatorContent.findUnique({
      where: { id: resolution.contentId },
      include: {
        creator: true,
        rightsGrant: {
          include: {
            versions: {
              where: { status: CreatorRightsGrantStatus.ACTIVE },
              take: 1,
              orderBy: { version: 'desc' },
              include: { rightsHolder: true, consents: true },
            },
          },
        },
      },
    });
    if (!content || content.lifecycleStatus !== CreatorContentLifecycleStatus.ACTIVE) {
      throw new ConflictException('CreatorContent nao esta ACTIVE no metering');
    }
    if (content.scope !== mapping.scope || content.gymId !== mapping.gymId) {
      throw new ConflictException('Content e mapping divergiram de escopo');
    }

    const approvedVersion = await tx.creatorContentVersion.findFirst({
      where: {
        contentId: content.id,
        mediaAssetId: resolution.mediaAssetId,
        status: CreatorContentVersionStatus.APPROVED,
      },
      orderBy: { version: 'desc' },
    });
    if (!approvedVersion) {
      throw new ConflictException(
        'CN6 APPROVED version do asset nao esta vigente no metering',
      );
    }

    const rights = this.effectiveRights(content);
    const attributionText = rights.attributionRequired
      ? rights.attributionText?.trim() || null
      : null;
    if (rights.attributionRequired && !attributionText) {
      throw new ConflictException(
        'Rights exige attribution, mas attributionText esta ausente',
      );
    }

    const creatorDisplayName = content.creator?.displayName?.trim() || null;
    const snapshotFingerprint = this.fingerprint({
      contentId: content.id,
      contentVersionId: approvedVersion.id,
      rightsGrantVersionId: rights.id,
      rightsHolderId: rights.rightsHolderId,
      creatorId: content.creatorId,
      creatorDisplayName,
      attributionRequired: rights.attributionRequired,
      attributionText,
    });

    let snapshot = await tx.creatorContentAttributionSnapshot.findUnique({
      where: { fingerprint: snapshotFingerprint },
    });
    if (!snapshot) {
      snapshot = await tx.creatorContentAttributionSnapshot.create({
        data: {
          contentId: content.id,
          contentVersionId: approvedVersion.id,
          rightsGrantVersionId: rights.id,
          rightsHolderId: rights.rightsHolderId,
          creatorId: content.creatorId,
          creatorDisplayName,
          attributionRequired: rights.attributionRequired,
          attributionText,
          fingerprint: snapshotFingerprint,
        },
      });
    }

    return {
      snapshot,
      attribution: {
        kind: 'MANAGED_CONTENT' as const,
        snapshotId: snapshot.id,
        creator: snapshot.creatorId
          ? {
              id: snapshot.creatorId,
              displayName: snapshot.creatorDisplayName,
            }
          : null,
        required: snapshot.attributionRequired,
        text: snapshot.attributionText,
        creatorCreditIsRightsOwnership: false,
      },
      approvedVersion,
    };
  }

  private async ensureDeliveryEvent(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ) {
    const existing = await tx.creatorContentUsageEvent.findFirst({
      where: {
        usageSessionId: sessionId,
        eventType: CreatorUsageEventType.DELIVERY_RESOLVED,
      },
    });
    if (existing) return existing;

    return tx.creatorContentUsageEvent.create({
      data: {
        usageSessionId: sessionId,
        eventKey: sessionId,
        eventType: CreatorUsageEventType.DELIVERY_RESOLVED,
        observationSource: CreatorUsageObservationSource.SERVER_OBSERVED,
        progressPercent: null,
        fingerprint: this.fingerprint({
          usageSessionId: sessionId,
          eventKey: sessionId,
          eventType: CreatorUsageEventType.DELIVERY_RESOLVED,
          observationSource: CreatorUsageObservationSource.SERVER_OBSERVED,
        }),
      },
    });
  }

  private async managedSession(
    gymId: string,
    actorUserId: string,
    audienceRole: AudienceRole,
    exerciseId: string,
    usageKey: string,
    resolution: any,
  ) {
    return this.serializable(async (tx) => {
      const captured = await this.captureManagedAttribution(
        tx,
        gymId,
        exerciseId,
        resolution,
      );
      const targetFingerprint = this.fingerprint({
        deliveryKind: 'MANAGED_CONTENT',
        mappingId: resolution.mappingId,
        contentId: resolution.contentId,
        contentVersionId: captured.approvedVersion.id,
        mediaAssetId: resolution.mediaAssetId,
        attributionSnapshotId: captured.snapshot.id,
        policyMode: resolution.policyMode,
      });

      let session = await tx.creatorContentUsageSession.findUnique({
        where: {
          gymId_actorUserId_resolutionKey: {
            gymId,
            actorUserId,
            resolutionKey: usageKey,
          },
        },
      });
      if (session) {
        if (
          session.audienceRole !== audienceRole ||
          session.exerciseId !== exerciseId ||
          session.deliveryKind !== CreatorUsageDeliveryKind.MANAGED_CONTENT ||
          session.mappingId !== resolution.mappingId ||
          session.contentId !== resolution.contentId ||
          session.contentVersionId !== captured.approvedVersion.id ||
          session.mediaAssetId !== resolution.mediaAssetId ||
          session.attributionSnapshotId !== captured.snapshot.id ||
          session.policyMode !== resolution.policyMode ||
          session.targetFingerprint !== targetFingerprint
        ) {
          throw new ConflictException(
            'x-iron-usage-key ja foi usado para outra resolucao',
          );
        }
      } else {
        session = await tx.creatorContentUsageSession.create({
          data: {
            gymId,
            actorUserId,
            audienceRole,
            exerciseId,
            resolutionKey: usageKey,
            deliveryKind: CreatorUsageDeliveryKind.MANAGED_CONTENT,
            mappingId: resolution.mappingId,
            contentId: resolution.contentId,
            contentVersionId: captured.approvedVersion.id,
            mediaAssetId: resolution.mediaAssetId,
            attributionSnapshotId: captured.snapshot.id,
            policyMode: resolution.policyMode,
            externalReferenceSource: null,
            targetFingerprint,
          },
        });
      }
      await this.ensureDeliveryEvent(tx, session.id);
      return { session, attribution: captured.attribution };
    });
  }

  private async externalSession(
    gymId: string,
    actorUserId: string,
    audienceRole: AudienceRole,
    exerciseId: string,
    usageKey: string,
    resolution: any,
  ) {
    return this.serializable(async (tx) => {
      const targetFingerprint = this.fingerprint({
        deliveryKind: 'EXTERNAL_REFERENCE',
        exerciseId,
        policyMode: resolution.policyMode,
        source: resolution.source,
        url: resolution.url,
      });

      let session = await tx.creatorContentUsageSession.findUnique({
        where: {
          gymId_actorUserId_resolutionKey: {
            gymId,
            actorUserId,
            resolutionKey: usageKey,
          },
        },
      });
      if (session) {
        if (
          session.audienceRole !== audienceRole ||
          session.exerciseId !== exerciseId ||
          session.deliveryKind !== CreatorUsageDeliveryKind.EXTERNAL_REFERENCE ||
          session.policyMode !== resolution.policyMode ||
          session.externalReferenceSource !== 'Exercise.videoUrl' ||
          session.targetFingerprint !== targetFingerprint
        ) {
          throw new ConflictException(
            'x-iron-usage-key ja foi usado para outra resolucao',
          );
        }
      } else {
        session = await tx.creatorContentUsageSession.create({
          data: {
            gymId,
            actorUserId,
            audienceRole,
            exerciseId,
            resolutionKey: usageKey,
            deliveryKind: CreatorUsageDeliveryKind.EXTERNAL_REFERENCE,
            mappingId: null,
            contentId: null,
            contentVersionId: null,
            mediaAssetId: null,
            attributionSnapshotId: null,
            policyMode: resolution.policyMode,
            externalReferenceSource: 'Exercise.videoUrl',
            targetFingerprint,
          },
        });
      }
      await this.ensureDeliveryEvent(tx, session.id);
      return session;
    });
  }

  async resolveExerciseContent(
    gymId: string | undefined,
    exerciseId: string,
    actorUserId: string,
    audienceRole: string,
    isStudent: boolean,
    rawUsageKey: string | undefined,
  ) {
    if (!gymId?.trim()) {
      throw new ForbiddenException('Usage metering exige tenant autenticado');
    }
    this.assertAudienceRole(audienceRole);
    const usageKey = this.normalizeUsageKey(rawUsageKey);

    const resolution = await this.publishing.resolveExerciseContent(
      gymId,
      exerciseId,
      actorUserId,
      isStudent,
    );
    if (resolution.kind === 'NONE') {
      return { ...resolution, usage: null, attribution: null };
    }

    if (resolution.kind === 'MANAGED_CONTENT') {
      const metered = await this.managedSession(
        gymId,
        actorUserId,
        audienceRole,
        exerciseId,
        usageKey,
        resolution,
      );
      return {
        ...resolution,
        attribution: metered.attribution,
        usage: {
          sessionId: metered.session.id,
          event: 'DELIVERY_RESOLVED' as const,
          observationSource: 'SERVER_OBSERVED' as const,
        },
      };
    }

    const session = await this.externalSession(
      gymId,
      actorUserId,
      audienceRole,
      exerciseId,
      usageKey,
      resolution,
    );
    return {
      ...resolution,
      attribution: {
        kind: 'EXTERNAL_REFERENCE' as const,
        required: false,
        text: null,
        ownershipClaimed: false,
        source: 'Exercise.videoUrl',
      },
      usage: {
        sessionId: session.id,
        event: 'DELIVERY_RESOLVED' as const,
        observationSource: 'SERVER_OBSERVED' as const,
      },
    };
  }

  private normalizeClientEvent(dto: RecordContentEngagementDto) {
    const eventType =
      dto.eventType === 'CONTENT_OPENED'
        ? CreatorUsageEventType.CONTENT_OPENED
        : dto.eventType === 'CONTENT_PROGRESS'
          ? CreatorUsageEventType.CONTENT_PROGRESS
          : dto.eventType === 'CONTENT_COMPLETED'
            ? CreatorUsageEventType.CONTENT_COMPLETED
            : CreatorUsageEventType.CONTENT_DISMISSED;
    const progress = dto.progressPercent ?? null;

    if (eventType === CreatorUsageEventType.CONTENT_OPENED && progress !== null) {
      throw new BadRequestException('CONTENT_OPENED nao aceita progressPercent');
    }
    if (
      eventType === CreatorUsageEventType.CONTENT_PROGRESS &&
      (progress === null || progress < 1 || progress > 99)
    ) {
      throw new BadRequestException('CONTENT_PROGRESS exige progressPercent entre 1 e 99');
    }
    if (
      eventType === CreatorUsageEventType.CONTENT_COMPLETED &&
      progress !== 100
    ) {
      throw new BadRequestException('CONTENT_COMPLETED exige progressPercent = 100');
    }
    if (
      eventType === CreatorUsageEventType.CONTENT_DISMISSED &&
      progress !== null &&
      (progress < 0 || progress > 99)
    ) {
      throw new BadRequestException(
        'CONTENT_DISMISSED aceita progressPercent apenas entre 0 e 99',
      );
    }
    return { eventType, progress };
  }

  async recordEngagement(
    gymId: string | undefined,
    actorUserId: string,
    exerciseId: string,
    usageSessionId: string,
    dto: RecordContentEngagementDto,
  ) {
    if (!gymId?.trim()) {
      throw new ForbiddenException('Engagement exige tenant autenticado');
    }
    const normalized = this.normalizeClientEvent(dto);

    return this.serializable(async (tx) => {
      const session = await tx.creatorContentUsageSession.findFirst({
        where: { id: usageSessionId, gymId, actorUserId, exerciseId },
      });
      if (!session) {
        throw new NotFoundException(
          'Usage session nao encontrada no tenant/usuario/exercicio',
        );
      }

      const eventKey = dto.eventKey.toLowerCase();
      const replay = await tx.creatorContentUsageEvent.findUnique({
        where: {
          usageSessionId_eventKey: {
            usageSessionId,
            eventKey,
          },
        },
      });
      if (replay) {
        if (
          replay.eventType === normalized.eventType &&
          replay.progressPercent === normalized.progress &&
          replay.observationSource === CreatorUsageObservationSource.CLIENT_REPORTED
        ) {
          return {
            event: replay,
            idempotent: true,
            trust: 'CLIENT_REPORTED' as const,
          };
        }
        throw new ConflictException('eventKey ja utilizado com payload divergente');
      }

      if (
        session.deliveryKind === CreatorUsageDeliveryKind.EXTERNAL_REFERENCE &&
        (normalized.eventType === CreatorUsageEventType.CONTENT_PROGRESS ||
          normalized.eventType === CreatorUsageEventType.CONTENT_COMPLETED)
      ) {
        throw new ConflictException(
          'Referencia externa nao permite alegar progresso/completion fora da observabilidade IRON',
        );
      }
      if (
        session.deliveryKind === CreatorUsageDeliveryKind.EXTERNAL_REFERENCE &&
        normalized.progress !== null
      ) {
        throw new ConflictException(
          'Referencia externa nao aceita progressPercent nao observavel pelo IRON',
        );
      }

      const terminal = await tx.creatorContentUsageEvent.findFirst({
        where: {
          usageSessionId,
          eventType: {
            in: [
              CreatorUsageEventType.CONTENT_COMPLETED,
              CreatorUsageEventType.CONTENT_DISMISSED,
            ],
          },
        },
      });
      if (terminal) {
        throw new ConflictException('Usage session ja possui evento terminal');
      }

      const opened = await tx.creatorContentUsageEvent.findFirst({
        where: {
          usageSessionId,
          eventType: CreatorUsageEventType.CONTENT_OPENED,
        },
      });
      if (normalized.eventType === CreatorUsageEventType.CONTENT_OPENED && opened) {
        throw new ConflictException('CONTENT_OPENED ja registrado para a session');
      }
      if (
        (normalized.eventType === CreatorUsageEventType.CONTENT_PROGRESS ||
          normalized.eventType === CreatorUsageEventType.CONTENT_COMPLETED) &&
        !opened
      ) {
        throw new ConflictException(
          'Progress/completion exige CONTENT_OPENED anterior',
        );
      }

      const highestProgress = await tx.creatorContentUsageEvent.findFirst({
        where: {
          usageSessionId,
          progressPercent: { not: null },
        },
        orderBy: { progressPercent: 'desc' },
      });
      const previousProgress = highestProgress?.progressPercent ?? 0;
      if (
        normalized.eventType === CreatorUsageEventType.CONTENT_PROGRESS &&
        normalized.progress !== null &&
        normalized.progress <= previousProgress
      ) {
        throw new ConflictException(
          'CONTENT_PROGRESS deve ser monotonicamente crescente',
        );
      }
      if (
        normalized.eventType === CreatorUsageEventType.CONTENT_DISMISSED &&
        normalized.progress !== null &&
        normalized.progress < previousProgress
      ) {
        throw new ConflictException(
          'CONTENT_DISMISSED nao pode regredir progressPercent observado',
        );
      }

      const event = await tx.creatorContentUsageEvent.create({
        data: {
          usageSessionId,
          eventKey,
          eventType: normalized.eventType,
          observationSource: CreatorUsageObservationSource.CLIENT_REPORTED,
          progressPercent: normalized.progress,
          fingerprint: this.fingerprint({
            usageSessionId,
            eventKey,
            eventType: normalized.eventType,
            observationSource: CreatorUsageObservationSource.CLIENT_REPORTED,
            progressPercent: normalized.progress,
          }),
        },
      });
      return {
        event,
        idempotent: false,
        trust: 'CLIENT_REPORTED' as const,
      };
    });
  }
}
