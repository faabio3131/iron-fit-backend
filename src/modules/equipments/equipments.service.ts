import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';

@Injectable()
export class EquipmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEquipmentDto, userGymId?: string) {
    const gymId = dto.gymId || userGymId;

    if (!gymId) {
      throw new NotFoundException('Academia nao informada');
    }

    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });

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

  async findAll(userGymId?: string) {
    return this.prisma.equipment.findMany({
      where: {
        ...(userGymId ? { gymId: userGymId } : {}),
        active: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, userGymId?: string) {
    const equipment = await this.prisma.equipment.findUnique({ where: { id } });

    if (!equipment) {
      throw new NotFoundException('Equipamento nao encontrado');
    }

    if (userGymId && equipment.gymId !== userGymId) {
      throw new NotFoundException('Equipamento nao encontrado');
    }

    return equipment;
  }
}
