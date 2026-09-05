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
  CreatorRightsHolderKind,
  CreatorRightsHolderStatus,
  CreatorRightsScope,
  CreatorStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateRightsConsentDto,
  CreateRightsGrantDto,
  CreateRightsGrantVersionDto,
  CreateRightsHolderDto,
} from './dto/rights-vault.dto';

const SERIALIZABLE_ATTEMPTS = 3;
const RIGHTS_TOKEN_PATTERN = /^[A-Z0-9][A-Z0-9_.:-]{0,63}$/;

export interface RightsVaultContext {
  scope: CreatorRightsScope;
  gymId: string | null;
}

interface NormalizedGrantTerms {
  rightsHolderId: string;
  basisKind: CreateRightsGrantDto['basisKind'];
  usageScopes: string[];
  deliveryScopes: string[];
  territories: string[];
  validFrom: Date;
  validUntil: Date | null;
  attributionRequired: boolean;
  attributionText: string | null;
  evidenceReference: string;
  evidenceSha256: string;
  termsSha256: string | null;
  requiresCreatorConsent: boolean;
}

@Injectable()
export class RightsVaultService {
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
    throw new ConflictException('Falha de concorrencia ao governar Rights Vault');
  }

  private async assertContext(
    tx: Prisma.TransactionClient,
    context: RightsVaultContext,
  ) {
    if (context.scope === CreatorRightsScope.GLOBAL) {
      if (context.gymId !== null) {
        throw new BadRequestException('Rights scope GLOBAL nao aceita gymId');
      }
      return;
    }

    if (!context.gymId) {
      throw new ForbiddenException('Rights scope TENANT exige tenant autenticado');
    }

    const gym = await tx.gym.findFirst({
      where: { id: context.gymId, active: true },
      select: { id: true },
    });
    if (!gym) throw new ForbiddenException('Tenant ativo nao encontrado');
  }

  private normalizeText(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeTokens(values: string[], label: string) {
    const normalized = [...new Set(values.map((value) => value.trim().toUpperCase()))]
      .filter(Boolean)
      .sort();
    if (normalized.length === 0) {
      throw new BadRequestException(`${label} exige ao menos um valor`);
    }
    for (const token of normalized) {
      if (!RIGHTS_TOKEN_PATTERN.test(token)) {
        throw new BadRequestException(`${label} contem token invalido: ${token}`);
      }
    }
    return normalized;
  }

  private parseValidity(validFromRaw: string, validUntilRaw?: string) {
    const validFrom = new Date(validFromRaw);
    const validUntil = validUntilRaw ? new Date(validUntilRaw) : null;
    if (Number.isNaN(validFrom.getTime())) {
      throw new BadRequestException('validFrom invalido');
    }
    if (validUntil && Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('validUntil invalido');
    }
    if (validUntil && validUntil <= validFrom) {
      throw new BadRequestException('validUntil deve ser posterior a validFrom');
    }
    return { validFrom, validUntil };
  }

  private fingerprint(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private normalizeGrantTerms(
    dto: CreateRightsGrantDto | CreateRightsGrantVersionDto,
  ): NormalizedGrantTerms {
    const { validFrom, validUntil } = this.parseValidity(
      dto.validFrom,
      dto.validUntil,
    );
    const attributionText = dto.attributionText
      ? this.normalizeText(dto.attributionText)
      : null;
    if (dto.attributionRequired && !attributionText) {
      throw new BadRequestException(
        'attributionRequired exige attributionText auditavel',
      );
    }

    return {
      rightsHolderId: dto.rightsHolderId,
      basisKind: dto.basisKind,
      usageScopes: this.normalizeTokens(dto.usageScopes, 'usageScopes'),
      deliveryScopes: this.normalizeTokens(dto.deliveryScopes, 'deliveryScopes'),
      territories: this.normalizeTokens(dto.territories, 'territories'),
      validFrom,
      validUntil,
      attributionRequired: dto.attributionRequired,
      attributionText,
      evidenceReference: dto.evidenceReference.trim(),
      evidenceSha256: dto.evidenceSha256.toLowerCase(),
      termsSha256: dto.termsSha256?.toLowerCase() ?? null,
      requiresCreatorConsent: dto.requiresCreatorConsent,
    };
  }

  private async scopedHolder(
    tx: Prisma.TransactionClient,
    context: RightsVaultContext,
    holderId: string,
  ) {
    const holder = await tx.creatorRightsHolder.findFirst({
      where: {
        id: holderId,
        scope: context.scope,
        gymId: context.gymId,
      },
      include: { creator: true },
    });
    if (!holder) throw new NotFoundException('Rights holder nao encontrado');
    return holder;
  }

  private async scopedGrant(
    tx: Prisma.TransactionClient,
    context: RightsVaultContext,
    grantId: string,
  ) {
    const grant = await tx.creatorRightsGrant.findFirst({
      where: {
        id: grantId,
        scope: context.scope,
        gymId: context.gymId,
      },
    });
    if (!grant) throw new NotFoundException('Rights grant nao encontrado');
    return grant;
  }

  private async scopedVersion(
    tx: Prisma.TransactionClient,
    context: RightsVaultContext,
    grantId: string,
    versionNumber: number,
  ) {
    await this.scopedGrant(tx, context, grantId);
    const version = await tx.creatorRightsGrantVersion.findUnique({
      where: {
        grantId_version: {
          grantId,
          version: versionNumber,
        },
      },
      include: {
        rightsHolder: true,
        consents: true,
      },
    });
    if (!version) throw new NotFoundException('Rights grant version nao encontrada');
    return version;
  }

  private assertGrantScope(
    context: RightsVaultContext,
    relationKind: CreatorManagedRelationKind,
  ) {
    if (
      context.scope === CreatorRightsScope.TENANT &&
      relationKind !== CreatorManagedRelationKind.TENANT_OWNED
    ) {
      throw new BadRequestException(
        'Rights grant TENANT deve usar relationKind TENANT_OWNED',
      );
    }
    if (
      context.scope === CreatorRightsScope.GLOBAL &&
      relationKind === CreatorManagedRelationKind.TENANT_OWNED
    ) {
      throw new BadRequestException(
        'TENANT_OWNED nao pode ser registrado como rights grant GLOBAL',
      );
    }
  }

  private async assertTermsEffective(
    tx: Prisma.TransactionClient,
    context: RightsVaultContext,
    version: {
      id: string;
      rightsHolderId: string;
      validFrom: Date;
      validUntil: Date | null;
      requiresCreatorConsent: boolean;
    },
    at: Date,
  ) {
    const holder = await this.scopedHolder(tx, context, version.rightsHolderId);
    if (holder.status !== CreatorRightsHolderStatus.ACTIVE) {
      throw new ConflictException('Rights holder nao esta ACTIVE');
    }
    if (version.validFrom > at) {
      throw new ConflictException('Rights grant ainda nao esta vigente');
    }
    if (version.validUntil && version.validUntil <= at) {
      throw new ConflictException('Rights grant expirou');
    }
    if (version.requiresCreatorConsent) {
      const validConsents = await tx.creatorRightsConsent.count({
        where: {
          grantVersionId: version.id,
          status: CreatorRightsConsentStatus.ACTIVE,
          validFrom: { lte: at },
          OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        },
      });
      if (validConsents === 0) {
        throw new ConflictException(
          'Rights grant exige consentimento de creator ACTIVE e vigente',
        );
      }
    }
  }

  async findHolders(context: RightsVaultContext) {
    if (context.scope === CreatorRightsScope.TENANT && !context.gymId) {
      throw new ForbiddenException('Tenant autenticado obrigatorio');
    }
    return this.prisma.creatorRightsHolder.findMany({
      where: { scope: context.scope, gymId: context.gymId },
      include: { creator: true },
      orderBy: [{ status: 'asc' }, { legalName: 'asc' }],
    });
  }

  async createHolder(
    context: RightsVaultContext,
    dto: CreateRightsHolderDto,
    actorUserId?: string,
  ) {
    const legalName = this.normalizeText(dto.legalName);
    const externalReference = dto.externalReference?.trim() || null;

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);

      if (dto.kind === CreatorRightsHolderKind.CREATOR) {
        if (!dto.creatorId) {
          throw new BadRequestException('Rights holder CREATOR exige creatorId');
        }
        const creator = await tx.creator.findUnique({ where: { id: dto.creatorId } });
        if (!creator) throw new NotFoundException('Creator nao encontrado');
        if (creator.status === CreatorStatus.RETIRED) {
          throw new ConflictException('Creator RETIRED nao recebe novo rights holder');
        }
      } else if (dto.creatorId) {
        throw new BadRequestException(
          'creatorId somente e permitido para rights holder CREATOR',
        );
      }

      if (
        dto.kind === CreatorRightsHolderKind.TENANT &&
        context.scope !== CreatorRightsScope.TENANT
      ) {
        throw new BadRequestException('Rights holder TENANT exige scope TENANT');
      }

      const fingerprint = this.fingerprint({
        scope: context.scope,
        gymId: context.gymId,
        kind: dto.kind,
        creatorId: dto.creatorId ?? null,
        legalName,
        externalReference,
      });
      const existing = await tx.creatorRightsHolder.findUnique({
        where: { fingerprint },
      });
      if (existing) return existing;

      const holder = await tx.creatorRightsHolder.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          kind: dto.kind,
          creatorId: dto.creatorId ?? null,
          legalName,
          externalReference,
          fingerprint,
          status: CreatorRightsHolderStatus.ACTIVE,
        },
      });

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_HOLDER_REGISTERED',
          entity: 'CreatorRightsHolder',
          entityId: holder.id,
          next: {
            scope: holder.scope,
            kind: holder.kind,
            creatorId: holder.creatorId,
            legalName: holder.legalName,
            fingerprint: holder.fingerprint,
            status: holder.status,
          },
        },
        tx,
      );

      return holder;
    });
  }

  async retireHolder(
    context: RightsVaultContext,
    holderId: string,
    reason: string,
    actorUserId?: string,
  ) {
    const normalizedReason = this.normalizeText(reason);
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const holder = await this.scopedHolder(tx, context, holderId);
      if (holder.status === CreatorRightsHolderStatus.RETIRED) return holder;

      const activeGrants = await tx.creatorRightsGrantVersion.count({
        where: {
          rightsHolderId: holder.id,
          status: CreatorRightsGrantStatus.ACTIVE,
        },
      });
      if (activeGrants > 0) {
        throw new ConflictException(
          'Rights holder com grant ACTIVE deve ter grants suspensos/revogados antes do retirement',
        );
      }

      const updated = await tx.creatorRightsHolder.update({
        where: { id: holder.id },
        data: { status: CreatorRightsHolderStatus.RETIRED },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_HOLDER_RETIRED',
          entity: 'CreatorRightsHolder',
          entityId: holder.id,
          previous: { status: holder.status },
          next: { status: updated.status, reason: normalizedReason },
        },
        tx,
      );
      return updated;
    });
  }

  async findGrants(context: RightsVaultContext) {
    if (context.scope === CreatorRightsScope.TENANT && !context.gymId) {
      throw new ForbiddenException('Tenant autenticado obrigatorio');
    }
    return this.prisma.creatorRightsGrant.findMany({
      where: { scope: context.scope, gymId: context.gymId },
      include: {
        versions: {
          include: { rightsHolder: true, consents: true },
          orderBy: { version: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findGrant(context: RightsVaultContext, grantId: string) {
    if (context.scope === CreatorRightsScope.TENANT && !context.gymId) {
      throw new ForbiddenException('Tenant autenticado obrigatorio');
    }
    const grant = await this.prisma.creatorRightsGrant.findFirst({
      where: {
        id: grantId,
        scope: context.scope,
        gymId: context.gymId,
      },
      include: {
        versions: {
          include: { rightsHolder: true, consents: true },
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!grant) throw new NotFoundException('Rights grant nao encontrado');
    return grant;
  }

  async createGrant(
    context: RightsVaultContext,
    dto: CreateRightsGrantDto,
    actorUserId?: string,
  ) {
    const terms = this.normalizeGrantTerms(dto);
    this.assertGrantScope(context, dto.relationKind);

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const holder = await this.scopedHolder(tx, context, terms.rightsHolderId);
      if (holder.status !== CreatorRightsHolderStatus.ACTIVE) {
        throw new ConflictException('Rights holder deve estar ACTIVE');
      }

      const fingerprint = this.fingerprint({
        scope: context.scope,
        gymId: context.gymId,
        relationKind: dto.relationKind,
        ...terms,
      });
      const existing = await tx.creatorRightsGrantVersion.findUnique({
        where: { fingerprint },
        include: { grant: true, rightsHolder: true, consents: true },
      });
      if (existing) return { grant: existing.grant, version: existing };

      const grant = await tx.creatorRightsGrant.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          relationKind: dto.relationKind,
        },
      });
      const version = await tx.creatorRightsGrantVersion.create({
        data: {
          grantId: grant.id,
          version: 1,
          ...terms,
          fingerprint,
          status: CreatorRightsGrantStatus.DRAFT,
        },
      });

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_GRANT_CREATED',
          entity: 'CreatorRightsGrant',
          entityId: grant.id,
          next: {
            scope: grant.scope,
            relationKind: grant.relationKind,
            version: 1,
            rightsHolderId: version.rightsHolderId,
            basisKind: version.basisKind,
            evidenceSha256: version.evidenceSha256,
            status: version.status,
          },
        },
        tx,
      );

      return { grant, version };
    });
  }

  async createGrantVersion(
    context: RightsVaultContext,
    grantId: string,
    dto: CreateRightsGrantVersionDto,
    actorUserId?: string,
  ) {
    const terms = this.normalizeGrantTerms(dto);
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const grant = await this.scopedGrant(tx, context, grantId);
      const holder = await this.scopedHolder(tx, context, terms.rightsHolderId);
      if (holder.status !== CreatorRightsHolderStatus.ACTIVE) {
        throw new ConflictException('Rights holder deve estar ACTIVE');
      }

      const fingerprint = this.fingerprint({ grantId: grant.id, ...terms });
      const existing = await tx.creatorRightsGrantVersion.findUnique({
        where: { fingerprint },
      });
      if (existing) return existing;

      const latest = await tx.creatorRightsGrantVersion.findFirst({
        where: { grantId: grant.id },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      const version = await tx.creatorRightsGrantVersion.create({
        data: {
          grantId: grant.id,
          version: nextVersion,
          ...terms,
          fingerprint,
          status: CreatorRightsGrantStatus.DRAFT,
        },
      });

      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_GRANT_VERSION_CREATED',
          entity: 'CreatorRightsGrantVersion',
          entityId: version.id,
          next: {
            grantId: grant.id,
            version: version.version,
            rightsHolderId: version.rightsHolderId,
            basisKind: version.basisKind,
            evidenceSha256: version.evidenceSha256,
            status: version.status,
          },
        },
        tx,
      );
      return version;
    });
  }

  async activateGrantVersion(
    context: RightsVaultContext,
    grantId: string,
    versionNumber: number,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const target = await this.scopedVersion(tx, context, grantId, versionNumber);
      if (target.status === CreatorRightsGrantStatus.ACTIVE) return target;
      if (target.status !== CreatorRightsGrantStatus.DRAFT) {
        throw new ConflictException('Somente rights grant DRAFT pode ser ativado');
      }

      const latest = await tx.creatorRightsGrantVersion.findFirst({
        where: { grantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (!latest || latest.version !== target.version) {
        throw new ConflictException('Somente a versao mais recente pode ser ativada');
      }

      const now = new Date();
      await this.assertTermsEffective(tx, context, target, now);
      const current = await tx.creatorRightsGrantVersion.findFirst({
        where: {
          grantId,
          status: CreatorRightsGrantStatus.ACTIVE,
          id: { not: target.id },
        },
      });
      if (current) {
        await tx.creatorRightsGrantVersion.update({
          where: { id: current.id },
          data: { status: CreatorRightsGrantStatus.SUPERSEDED },
        });
        await this.audit.record(
          {
            gymId: context.gymId,
            userId: actorUserId ?? null,
            action: 'RIGHTS_GRANT_VERSION_SUPERSEDED',
            entity: 'CreatorRightsGrantVersion',
            entityId: current.id,
            previous: { status: current.status, version: current.version },
            next: {
              status: CreatorRightsGrantStatus.SUPERSEDED,
              supersededByVersion: target.version,
            },
          },
          tx,
        );
      }

      const updated = await tx.creatorRightsGrantVersion.update({
        where: { id: target.id },
        data: {
          status: CreatorRightsGrantStatus.ACTIVE,
          activatedAt: now,
          suspendedAt: null,
          suspensionReason: null,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_GRANT_VERSION_ACTIVATED',
          entity: 'CreatorRightsGrantVersion',
          entityId: target.id,
          previous: { status: target.status },
          next: {
            status: updated.status,
            version: updated.version,
            activatedAt: now.toISOString(),
          },
        },
        tx,
      );
      return updated;
    });
  }

  async suspendGrantVersion(
    context: RightsVaultContext,
    grantId: string,
    versionNumber: number,
    reason: string,
    actorUserId?: string,
  ) {
    const normalizedReason = this.normalizeText(reason);
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const version = await this.scopedVersion(tx, context, grantId, versionNumber);
      if (version.status === CreatorRightsGrantStatus.SUSPENDED) return version;
      if (version.status !== CreatorRightsGrantStatus.ACTIVE) {
        throw new ConflictException('Somente rights grant ACTIVE pode ser suspenso');
      }
      const suspendedAt = new Date();
      const updated = await tx.creatorRightsGrantVersion.update({
        where: { id: version.id },
        data: {
          status: CreatorRightsGrantStatus.SUSPENDED,
          suspendedAt,
          suspensionReason: normalizedReason,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_GRANT_VERSION_SUSPENDED',
          entity: 'CreatorRightsGrantVersion',
          entityId: version.id,
          previous: { status: version.status },
          next: {
            status: updated.status,
            reason: normalizedReason,
            suspendedAt: suspendedAt.toISOString(),
          },
        },
        tx,
      );
      return updated;
    });
  }

  async resumeGrantVersion(
    context: RightsVaultContext,
    grantId: string,
    versionNumber: number,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const version = await this.scopedVersion(tx, context, grantId, versionNumber);
      if (version.status === CreatorRightsGrantStatus.ACTIVE) return version;
      if (version.status !== CreatorRightsGrantStatus.SUSPENDED) {
        throw new ConflictException('Somente rights grant SUSPENDED pode ser retomado');
      }

      const latest = await tx.creatorRightsGrantVersion.findFirst({
        where: { grantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (!latest || latest.version !== version.version) {
        throw new ConflictException('Versao supersedida nao pode ser retomada');
      }
      const otherActive = await tx.creatorRightsGrantVersion.count({
        where: {
          grantId,
          status: CreatorRightsGrantStatus.ACTIVE,
          id: { not: version.id },
        },
      });
      if (otherActive > 0) {
        throw new ConflictException('Grant ja possui outra versao ACTIVE');
      }

      const now = new Date();
      await this.assertTermsEffective(tx, context, version, now);
      const updated = await tx.creatorRightsGrantVersion.update({
        where: { id: version.id },
        data: {
          status: CreatorRightsGrantStatus.ACTIVE,
          activatedAt: version.activatedAt ?? now,
          suspendedAt: null,
          suspensionReason: null,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_GRANT_VERSION_RESUMED',
          entity: 'CreatorRightsGrantVersion',
          entityId: version.id,
          previous: { status: version.status },
          next: { status: updated.status },
        },
        tx,
      );
      return updated;
    });
  }

  async revokeGrantVersion(
    context: RightsVaultContext,
    grantId: string,
    versionNumber: number,
    reason: string,
    actorUserId?: string,
  ) {
    const normalizedReason = this.normalizeText(reason);
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const version = await this.scopedVersion(tx, context, grantId, versionNumber);
      if (version.status === CreatorRightsGrantStatus.REVOKED) return version;
      if (version.status === CreatorRightsGrantStatus.SUPERSEDED) {
        throw new ConflictException('Versao SUPERSEDED permanece historica e imutavel');
      }
      const revokedAt = new Date();
      const updated = await tx.creatorRightsGrantVersion.update({
        where: { id: version.id },
        data: {
          status: CreatorRightsGrantStatus.REVOKED,
          revokedAt,
          revocationReason: normalizedReason,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_GRANT_VERSION_REVOKED',
          entity: 'CreatorRightsGrantVersion',
          entityId: version.id,
          previous: { status: version.status },
          next: {
            status: updated.status,
            reason: normalizedReason,
            revokedAt: revokedAt.toISOString(),
          },
        },
        tx,
      );
      return updated;
    });
  }

  async addConsent(
    context: RightsVaultContext,
    grantId: string,
    versionNumber: number,
    dto: CreateRightsConsentDto,
    actorUserId?: string,
  ) {
    const { validFrom, validUntil } = this.parseValidity(
      dto.validFrom,
      dto.validUntil,
    );
    const purposeScopes = this.normalizeTokens(dto.purposeScopes, 'purposeScopes');
    const evidenceReference = dto.evidenceReference.trim();
    const evidenceSha256 = dto.evidenceSha256.toLowerCase();

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const grantVersion = await this.scopedVersion(
        tx,
        context,
        grantId,
        versionNumber,
      );
      if (
        grantVersion.status === CreatorRightsGrantStatus.REVOKED ||
        grantVersion.status === CreatorRightsGrantStatus.SUPERSEDED
      ) {
        throw new ConflictException(
          'Grant version terminal nao recebe novo consentimento',
        );
      }

      const creator = await tx.creator.findUnique({ where: { id: dto.creatorId } });
      if (!creator) throw new NotFoundException('Creator nao encontrado');
      if (creator.status !== CreatorStatus.ACTIVE) {
        throw new ConflictException(
          'Novo consentimento exige Creator ACTIVE com identidade governada no CN1',
        );
      }

      const fingerprint = this.fingerprint({
        grantVersionId: grantVersion.id,
        creatorId: dto.creatorId,
        kind: dto.kind,
        purposeScopes,
        validFrom,
        validUntil,
        evidenceReference,
        evidenceSha256,
      });
      const existing = await tx.creatorRightsConsent.findUnique({
        where: { fingerprint },
      });
      if (existing) return existing;

      const latest = await tx.creatorRightsConsent.findFirst({
        where: {
          grantVersionId: grantVersion.id,
          creatorId: dto.creatorId,
          kind: dto.kind,
        },
        orderBy: { version: 'desc' },
      });
      const current = await tx.creatorRightsConsent.findFirst({
        where: {
          grantVersionId: grantVersion.id,
          creatorId: dto.creatorId,
          kind: dto.kind,
          status: CreatorRightsConsentStatus.ACTIVE,
        },
      });
      if (current) {
        await tx.creatorRightsConsent.update({
          where: { id: current.id },
          data: { status: CreatorRightsConsentStatus.SUPERSEDED },
        });
        await this.audit.record(
          {
            gymId: context.gymId,
            userId: actorUserId ?? null,
            action: 'RIGHTS_CONSENT_SUPERSEDED',
            entity: 'CreatorRightsConsent',
            entityId: current.id,
            previous: { status: current.status, version: current.version },
            next: {
              status: CreatorRightsConsentStatus.SUPERSEDED,
              supersededByVersion: (latest?.version ?? 0) + 1,
            },
          },
          tx,
        );
      }

      const consent = await tx.creatorRightsConsent.create({
        data: {
          grantVersionId: grantVersion.id,
          creatorId: dto.creatorId,
          kind: dto.kind,
          version: (latest?.version ?? 0) + 1,
          status: CreatorRightsConsentStatus.ACTIVE,
          purposeScopes,
          validFrom,
          validUntil,
          evidenceReference,
          evidenceSha256,
          fingerprint,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_CONSENT_RECORDED',
          entity: 'CreatorRightsConsent',
          entityId: consent.id,
          next: {
            grantVersionId: consent.grantVersionId,
            creatorId: consent.creatorId,
            kind: consent.kind,
            version: consent.version,
            evidenceSha256: consent.evidenceSha256,
            status: consent.status,
          },
        },
        tx,
      );
      return consent;
    });
  }

  async revokeConsent(
    context: RightsVaultContext,
    grantId: string,
    versionNumber: number,
    consentId: string,
    reason: string,
    actorUserId?: string,
  ) {
    const normalizedReason = this.normalizeText(reason);
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const grantVersion = await this.scopedVersion(
        tx,
        context,
        grantId,
        versionNumber,
      );
      const consent = await tx.creatorRightsConsent.findFirst({
        where: { id: consentId, grantVersionId: grantVersion.id },
      });
      if (!consent) throw new NotFoundException('Rights consent nao encontrado');
      if (consent.status === CreatorRightsConsentStatus.REVOKED) {
        return { consent, grantVersion };
      }
      if (consent.status === CreatorRightsConsentStatus.SUPERSEDED) {
        throw new ConflictException('Consentimento SUPERSEDED e historico e imutavel');
      }

      const revokedAt = new Date();
      const updatedConsent = await tx.creatorRightsConsent.update({
        where: { id: consent.id },
        data: {
          status: CreatorRightsConsentStatus.REVOKED,
          revokedAt,
          revocationReason: normalizedReason,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'RIGHTS_CONSENT_REVOKED',
          entity: 'CreatorRightsConsent',
          entityId: consent.id,
          previous: { status: consent.status },
          next: {
            status: updatedConsent.status,
            reason: normalizedReason,
            revokedAt: revokedAt.toISOString(),
          },
        },
        tx,
      );

      let updatedGrantVersion = grantVersion;
      if (
        grantVersion.status === CreatorRightsGrantStatus.ACTIVE &&
        grantVersion.requiresCreatorConsent
      ) {
        const now = new Date();
        const remaining = await tx.creatorRightsConsent.count({
          where: {
            grantVersionId: grantVersion.id,
            id: { not: consent.id },
            status: CreatorRightsConsentStatus.ACTIVE,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
        });
        if (remaining === 0) {
          updatedGrantVersion = await tx.creatorRightsGrantVersion.update({
            where: { id: grantVersion.id },
            data: {
              status: CreatorRightsGrantStatus.SUSPENDED,
              suspendedAt: now,
              suspensionReason: 'REQUIRED_CREATOR_CONSENT_REVOKED',
            },
            include: { rightsHolder: true, consents: true },
          });
          await this.audit.record(
            {
              gymId: context.gymId,
              userId: actorUserId ?? null,
              action: 'RIGHTS_GRANT_AUTO_SUSPENDED_NO_REQUIRED_CONSENT',
              entity: 'CreatorRightsGrantVersion',
              entityId: grantVersion.id,
              previous: { status: grantVersion.status },
              next: {
                status: updatedGrantVersion.status,
                reason: 'REQUIRED_CREATOR_CONSENT_REVOKED',
              },
            },
            tx,
          );
        }
      }

      return { consent: updatedConsent, grantVersion: updatedGrantVersion };
    });
  }

  async evaluateGrant(context: RightsVaultContext, grantId: string) {
    const now = new Date();
    const grant = await this.findGrant(context, grantId);
    const active = grant.versions.find(
      (version) => version.status === CreatorRightsGrantStatus.ACTIVE,
    );
    if (!active) {
      const latest = grant.versions[0] ?? null;
      return {
        grantId: grant.id,
        relationKind: grant.relationKind,
        effective: false,
        reason: latest ? `LATEST_VERSION_${latest.status}` : 'NO_VERSION',
        latestVersion: latest?.version ?? null,
      };
    }

    let reason = 'EFFECTIVE';
    let effective = true;
    if (active.rightsHolder.status !== CreatorRightsHolderStatus.ACTIVE) {
      effective = false;
      reason = 'RIGHTS_HOLDER_INACTIVE';
    } else if (active.validFrom > now) {
      effective = false;
      reason = 'NOT_YET_VALID';
    } else if (active.validUntil && active.validUntil <= now) {
      effective = false;
      reason = 'EXPIRED';
    } else if (active.requiresCreatorConsent) {
      const validConsent = active.consents.some(
        (consent) =>
          consent.status === CreatorRightsConsentStatus.ACTIVE &&
          consent.validFrom <= now &&
          (!consent.validUntil || consent.validUntil > now),
      );
      if (!validConsent) {
        effective = false;
        reason = 'REQUIRED_CREATOR_CONSENT_MISSING';
      }
    }

    return {
      grantId: grant.id,
      relationKind: grant.relationKind,
      version: active.version,
      status: active.status,
      effective,
      reason,
      rights: {
        rightsHolderId: active.rightsHolderId,
        basisKind: active.basisKind,
        usageScopes: active.usageScopes,
        deliveryScopes: active.deliveryScopes,
        territories: active.territories,
        validFrom: active.validFrom,
        validUntil: active.validUntil,
        attributionRequired: active.attributionRequired,
        attributionText: active.attributionText,
        evidenceSha256: active.evidenceSha256,
        termsSha256: active.termsSha256,
        requiresCreatorConsent: active.requiresCreatorConsent,
      },
    };
  }
}
