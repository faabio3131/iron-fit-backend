import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { EquipmentCatalogQueryDto } from './dto/equipment-catalog-query.dto';
import { SelectCatalogEquipmentDto } from './dto/select-catalog-equipment.dto';

@Injectable()
export class EquipmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async ensureActiveGym(gymId: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, active: true },
      select: { id: true },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }
  }

  async create(dto: CreateEquipmentDto, gymId: string) {
    await this.ensureActiveGym(gymId);

    return this.prisma.equipment.create({
      data: {
        gymId,
        name: dto.name,
        standardName: dto.standardName,
        type: dto.type,
        primaryMuscle: dto.primaryMuscle,
        secondaryMuscles: dto.secondaryMuscles,
        movementPattern: dto.movementPattern,
        difficulty: dto.difficulty,
        contraindications: dto.contraindications,
        videoUrl: dto.videoUrl,
      } as any,
    });
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

    const existing = await this.prisma.equipment.findFirst({
      where: { gymId, catalogItemId },
      include: { catalogItem: true },
    });

    if (!existing) {
      throw new NotFoundException('Equipamento do catalogo nao selecionado por esta academia');
    }

    if (!existing.active) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.equipment.update({
        where: { id: existing.id },
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
