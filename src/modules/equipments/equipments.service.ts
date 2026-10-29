import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { findEquipmentExerciseMapping } from '../../common/equipment/equipment-exercise-mapping';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { EquipmentCatalogQueryDto } from './dto/equipment-catalog-query.dto';
import { SelectCatalogEquipmentDto } from './dto/select-catalog-equipment.dto';
import { SubmitEquipmentCatalogCandidateDto } from './dto/submit-equipment-catalog-candidate.dto';
import { EquipmentCatalogCandidateQueryDto } from './dto/equipment-catalog-candidate-query.dto';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';
import {
  EquipmentCatalogCandidateDecision,
  ReviewEquipmentCatalogCandidateDto,
} from './dto/review-equipment-catalog-candidate.dto';

@Injectable()
export class EquipmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private entitlements: TenantProductEntitlementsService,
  ) {}

  async updateOperationalStatus(id: string, gymId: string, userId: string, status: string) {
    if (!['OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE'].includes(status)) {
      throw new BadRequestException('Estado operacional invalido');
    }
    await this.ensureActiveGym(gymId);
    const entitlement = await this.entitlements.resolveFeature(gymId, 'equipment.inventory');
    if (entitlement.kind !== 'FEATURE' || entitlement.value !== true) {
      throw new ForbiddenException('Inventario de equipamentos indisponivel para esta academia');
    }
    return this.prisma.$transaction(async (tx) => {
      const equipment = await tx.equipment.findFirst({ where: { id, gymId } });
      if (!equipment) throw new NotFoundException('Equipamento nao encontrado');
      if (equipment.operationalStatus === status) return equipment;
      const changedAt = new Date();
      const changed = await tx.equipment.updateMany({
        where: { id, gymId, operationalStatus: equipment.operationalStatus, operationalStatusChangedAt: equipment.operationalStatusChangedAt },
        data: { operationalStatus: status, operationalStatusChangedAt: changedAt },
      });
      if (changed.count !== 1) throw new ConflictException('Estado do equipamento foi alterado; atualize e tente novamente');
      await this.audit.record({ gymId, userId, action: 'EQUIPMENT_OPERATIONAL_STATUS_CHANGED', entity: 'Equipment', entityId: id, previous: { status: equipment.operationalStatus }, next: { status } }, tx);
      return tx.equipment.findFirstOrThrow({ where: { id, gymId } });
    });
  }

  private async ensureActiveGym(gymId: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, active: true },
      select: { id: true },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }
  }

  private normalizeCandidateValue(value?: string) {
    return (value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR');
  }

  private slugifyCatalogName(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private candidateFingerprint(dto: SubmitEquipmentCatalogCandidateDto) {
    const aliases = (dto.aliases ?? [])
      .map((alias) => this.normalizeCandidateValue(alias))
      .filter(Boolean)
      .sort();
    const canonical = JSON.stringify({
      proposedName: this.normalizeCandidateValue(dto.proposedName),
      proposedCategory: dto.proposedCategory ?? null,
      manufacturerName: this.normalizeCandidateValue(dto.manufacturerName),
      modelName: this.normalizeCandidateValue(dto.modelName),
      aliases,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  async create(dto: CreateEquipmentDto, gymId: string) {
    await this.ensureActiveGym(gymId);
    void dto;
    throw new BadRequestException(
      'Cadastro manual de novos equipamentos encerrado; use o catalogo mestre ou envie um candidato para revisao',
    );
  }

  async findCatalog(query: EquipmentCatalogQueryDto, gymId: string) {
    await this.ensureActiveGym(gymId);

    const [catalog, inventory] = await Promise.all([
      this.prisma.equipmentCatalogItem.findMany({
        where: {
          active: true,
          ...(query.category ? { category: query.category } : {}),
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        take: 500,
      }),
      this.prisma.equipment.findMany({
        where: { gymId, catalogItemId: { not: null } },
        select: { id: true, catalogItemId: true, active: true },
      }),
    ]);

    const inventoryByCatalogId = new Map(
      inventory
        .filter((item) => item.catalogItemId)
        .map((item) => [item.catalogItemId as string, item]),
    );
    const search = query.search?.trim().toLocaleLowerCase('pt-BR');
    const limit = query.limit ?? 250;

    return catalog
      .filter((item) => {
        if (!search) return true;
        const aliases = Array.isArray(item.aliases)
          ? item.aliases.filter((alias): alias is string => typeof alias === 'string')
          : [];
        return [item.name, item.slug, ...aliases]
          .some((value) => value.toLocaleLowerCase('pt-BR').includes(search));
      })
      .slice(0, limit)
      .map((item) => {
        const inventoryItem = inventoryByCatalogId.get(item.id);
        return {
          ...item,
          selected: inventoryItem?.active === true,
          inventoryId: inventoryItem?.id ?? null,
        };
      });
  }

  async findCompatibleForExercise(exerciseId: string, gymId: string) {
    await this.ensureActiveGym(gymId);

    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { id: true, name: true },
    });
    if (!exercise) {
      throw new NotFoundException('Exercicio nao encontrado');
    }

    const inventory = await this.prisma.equipment.findMany({
      where: {
        gymId,
        active: true,
        catalogItemId: { not: null },
      },
      include: { catalogItem: true },
      orderBy: { name: 'asc' },
    });

    return inventory
      .flatMap((item) => {
        const mapping = findEquipmentExerciseMapping(
          item.catalogItem?.metadata,
          exercise.id,
          exercise.name,
        );
        return mapping
          ? [{
              ...item,
              compatibility: mapping.compatibility,
              mappingPriority: mapping.priority,
              mappingVersion: mapping.sourceVersion,
            }]
          : [];
      })
      .sort((left, right) =>
        left.mappingPriority - right.mappingPriority || left.name.localeCompare(right.name),
      );
  }

  async submitCatalogCandidate(
    dto: SubmitEquipmentCatalogCandidateDto,
    gymId: string,
    actorUserId?: string,
  ) {
    await this.ensureActiveGym(gymId);

    const proposedName = dto.proposedName.trim().replace(/\s+/g, ' ');
    const proposedSlug = this.slugifyCatalogName(proposedName);
    if (!proposedSlug) {
      throw new BadRequestException('Nome de equipamento candidato invalido');
    }

    const fingerprint = this.candidateFingerprint(dto);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingCatalog = await tx.equipmentCatalogItem.findFirst({
          where: {
            active: true,
            OR: [
              { slug: proposedSlug },
              { name: { equals: proposedName, mode: 'insensitive' } },
            ],
          },
          select: { id: true, slug: true, name: true },
        });
        if (existingCatalog) {
          throw new BadRequestException(
            'Equipamento ja existe no catalogo mestre; use a selecao de inventario',
          );
        }

        const existingCandidate = await tx.equipmentCatalogCandidate.findUnique({
          where: { gymId_fingerprint: { gymId, fingerprint } },
        });
        if (existingCandidate) {
          return existingCandidate;
        }

        const candidate = await tx.equipmentCatalogCandidate.create({
          data: {
            gymId,
            submittedByUserId: actorUserId ?? null,
            fingerprint,
            proposedName,
            proposedCategory: dto.proposedCategory,
            manufacturerName: dto.manufacturerName?.trim() || null,
            modelName: dto.modelName?.trim() || null,
            aliases: dto.aliases?.map((alias) => alias.trim()).filter(Boolean),
            evidenceUrl: dto.evidenceUrl?.trim() || null,
            notes: dto.notes?.trim() || null,
          },
        });

        await this.audit.record({
          gymId,
          userId: actorUserId ?? null,
          action: 'EQUIPMENT_CATALOG_CANDIDATE_SUBMITTED',
          entity: 'EquipmentCatalogCandidate',
          entityId: candidate.id,
          next: {
            status: candidate.status,
            proposedName: candidate.proposedName,
            proposedCategory: candidate.proposedCategory,
            manufacturerName: candidate.manufacturerName,
            modelName: candidate.modelName,
          },
        }, tx);

        return candidate;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const existing = await this.prisma.equipmentCatalogCandidate.findUnique({
          where: { gymId_fingerprint: { gymId, fingerprint } },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async findCatalogCandidates(
    query: EquipmentCatalogCandidateQueryDto,
    gymId: string,
  ) {
    await this.ensureActiveGym(gymId);
    return this.prisma.equipmentCatalogCandidate.findMany({
      where: {
        gymId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
  }

  async findGovernanceCatalogCandidates(query: EquipmentCatalogCandidateQueryDto) {
    return this.prisma.equipmentCatalogCandidate.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.gymId ? { gymId: query.gymId } : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: query.limit ?? 200,
    });
  }

  async reviewCatalogCandidate(
    candidateId: string,
    dto: ReviewEquipmentCatalogCandidateDto,
    actorUserId?: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const candidate = await tx.equipmentCatalogCandidate.findUnique({
          where: { id: candidateId },
        });
        if (!candidate) {
          throw new NotFoundException('Candidato de equipamento nao encontrado');
        }

        if (candidate.status !== 'PENDING') {
          const catalogItem = candidate.resolvedCatalogItemId
            ? await tx.equipmentCatalogItem.findUnique({
                where: { id: candidate.resolvedCatalogItemId },
              })
            : null;
          return { candidate, catalogItem, idempotent: true };
        }

        const reviewedAt = new Date();
        let resolvedCatalogItemId: string | null = null;
        let catalogItem: Awaited<ReturnType<typeof tx.equipmentCatalogItem.findUnique>> = null;
        let nextStatus: 'APPROVED' | 'MERGED' | 'REJECTED';

        if (dto.decision === EquipmentCatalogCandidateDecision.MERGE) {
          if (!dto.catalogItemId) {
            throw new BadRequestException('MERGE exige catalogItemId existente');
          }
          catalogItem = await tx.equipmentCatalogItem.findFirst({
            where: { id: dto.catalogItemId, active: true },
          });
          if (!catalogItem) {
            throw new NotFoundException('Item canonico para merge nao encontrado');
          }
          resolvedCatalogItemId = catalogItem.id;
          nextStatus = 'MERGED';
        } else if (dto.decision === EquipmentCatalogCandidateDecision.APPROVE) {
          const canonicalName = (dto.canonicalName ?? candidate.proposedName)
            .trim()
            .replace(/\s+/g, ' ');
          const canonicalSlug = dto.canonicalSlug ?? this.slugifyCatalogName(canonicalName);
          const canonicalCategory = dto.canonicalCategory ?? candidate.proposedCategory;

          if (!canonicalSlug || !canonicalCategory) {
            throw new BadRequestException(
              'APPROVE exige nome/slug valido e categoria canonica definida',
            );
          }

          const duplicate = await tx.equipmentCatalogItem.findFirst({
            where: {
              OR: [
                { slug: canonicalSlug },
                { name: { equals: canonicalName, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          });
          if (duplicate) {
            throw new BadRequestException(
              'Item canonico equivalente ja existe; use decisao MERGE',
            );
          }

          catalogItem = await tx.equipmentCatalogItem.create({
            data: {
              slug: canonicalSlug,
              name: canonicalName,
              category: canonicalCategory,
              aliases: candidate.aliases as any,
              metadata: {
                catalogGovernance: {
                  source: 'EQ5_CANDIDATE_APPROVAL',
                  candidateId: candidate.id,
                  reviewedAt: reviewedAt.toISOString(),
                },
              },
              active: true,
            },
          });
          resolvedCatalogItemId = catalogItem.id;
          nextStatus = 'APPROVED';

          await this.audit.record({
            gymId: candidate.gymId,
            userId: actorUserId ?? null,
            action: 'EQUIPMENT_CATALOG_ITEM_CREATED_FROM_CANDIDATE',
            entity: 'EquipmentCatalogItem',
            entityId: catalogItem.id,
            next: {
              slug: catalogItem.slug,
              name: catalogItem.name,
              category: catalogItem.category,
              sourceCandidateId: candidate.id,
            },
          }, tx);
        } else {
          if (!dto.reviewNotes?.trim()) {
            throw new BadRequestException('REJECT exige justificativa de revisao');
          }
          nextStatus = 'REJECTED';
        }

        const updated = await tx.equipmentCatalogCandidate.update({
          where: { id: candidate.id },
          data: {
            status: nextStatus,
            resolvedCatalogItemId,
            reviewNotes: dto.reviewNotes?.trim() || null,
            reviewedByUserId: actorUserId ?? null,
            reviewedAt,
          },
        });

        await this.audit.record({
          gymId: candidate.gymId,
          userId: actorUserId ?? null,
          action: `EQUIPMENT_CATALOG_CANDIDATE_${nextStatus}`,
          entity: 'EquipmentCatalogCandidate',
          entityId: candidate.id,
          previous: {
            status: candidate.status,
            resolvedCatalogItemId: candidate.resolvedCatalogItemId,
          },
          next: {
            status: updated.status,
            resolvedCatalogItemId: updated.resolvedCatalogItemId,
            reviewedAt: updated.reviewedAt,
          },
        }, tx);

        return { candidate: updated, catalogItem, idempotent: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new BadRequestException(
          'Conflito de identidade canonica; revise o candidato e use MERGE quando o item ja existir',
        );
      }
      throw error;
    }
  }

  async selectCatalog(
    dto: SelectCatalogEquipmentDto,
    gymId: string,
    actorUserId?: string,
  ) {
    await this.ensureActiveGym(gymId);

    const catalogItemIds = [...new Set(dto.catalogItemIds)];
    const catalogItems = await this.prisma.equipmentCatalogItem.findMany({
      where: {
        id: { in: catalogItemIds },
        active: true,
      },
      orderBy: { name: 'asc' },
    });

    if (catalogItems.length !== catalogItemIds.length) {
      throw new BadRequestException('Um ou mais equipamentos do catalogo sao invalidos ou inativos');
    }

    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.equipment.findMany({
        where: { gymId, catalogItemId: { in: catalogItemIds } },
        select: { id: true, catalogItemId: true, active: true },
      });

      const selected: Prisma.EquipmentGetPayload<{ include: { catalogItem: true } }>[] = [];
      for (const item of catalogItems) {
        const equipment = await tx.equipment.upsert({
          where: {
            gymId_catalogItemId: {
              gymId,
              catalogItemId: item.id,
            },
          },
          update: {
            active: true,
            name: item.name,
            standardName: item.name,
            type: item.category,
            primaryMuscle: item.primaryMuscle,
          },
          create: {
            gymId,
            catalogItemId: item.id,
            name: item.name,
            standardName: item.name,
            type: item.category,
            primaryMuscle: item.primaryMuscle,
            active: true,
          },
          include: { catalogItem: true },
        });
        selected.push(equipment);
      }

      await this.audit.record({
        gymId,
        userId: actorUserId ?? null,
        action: 'GYM_EQUIPMENT_CATALOG_SELECTED',
        entity: 'Equipment',
        entityId: gymId,
        previous,
        next: selected.map((item) => ({
          id: item.id,
          catalogItemId: item.catalogItemId,
          active: item.active,
        })),
      }, tx);

      return selected;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async deselectCatalog(catalogItemId: string, gymId: string, actorUserId?: string) {
    await this.ensureActiveGym(gymId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.equipment.findFirst({
          where: { gymId, catalogItemId },
          include: { catalogItem: true },
        });
        if (!existing) {
          throw new NotFoundException('Equipamento do catalogo nao selecionado por esta academia');
        }
        if (!existing.active) {
          return existing;
        }

        // Compare-and-swap guards tenant, catalog identity and active state
        // against concurrent selection/deselection and prevents false audits.
        const updated = await tx.equipment.update({
          where: { id: existing.id, gymId, catalogItemId, active: true },
          data: { active: false },
          include: { catalogItem: true },
        });

        await this.audit.record({
          gymId,
          userId: actorUserId ?? null,
          action: 'GYM_EQUIPMENT_CATALOG_DESELECTED',
          entity: 'Equipment',
          entityId: updated.id,
          previous: { catalogItemId, active: true },
          next: { catalogItemId, active: false },
        }, tx);

        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2025' || error.code === 'P2034')
      ) {
        throw new BadRequestException('Inventario alterado por outra operacao; atualize e tente novamente');
      }
      throw error;
    }
  }

  async findAll(gymId: string) {
    return this.prisma.equipment.findMany({
      where: {
        gymId,
        active: true,
      },
      include: { catalogItem: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, gymId: string) {
    const equipment = await this.prisma.equipment.findFirst({
      where: { id, gymId },
      include: { catalogItem: true },
    });

    if (!equipment) {
      throw new NotFoundException('Equipamento nao encontrado');
    }

    return equipment;
  }
}
