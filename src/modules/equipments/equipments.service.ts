import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';

@Injectable()
export class EquipmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEquipmentDto, gymId: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, active: true },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }

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

  async findAll(gymId: string) {
    return this.prisma.equipment.findMany({
      where: {
        gymId,
        active: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, gymId: string) {
    const equipment = await this.prisma.equipment.findFirst({
      where: { id, gymId },
    });

    if (!equipment) {
      throw new NotFoundException('Equipamento nao encontrado');
    }

    return equipment;
  }
}
