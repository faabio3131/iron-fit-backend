import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGymDto } from './dto/create-gym.dto';

@Injectable()
export class GymsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateGymDto) {
    const existing = await this.prisma.gym.findUnique({
      where: { slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException('Slug ja existe');
    }

    const gym = await this.prisma.gym.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        logoUrl: dto.logoUrl,
        timezone: dto.timezone || 'America/Sao_Paulo',
      },
    });

    return gym;
  }

  async findAll() {
    return this.prisma.gym.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    activeGymId?: string | null,
    isSuperAdmin = false,
  ) {
    if (!isSuperAdmin && (!activeGymId || id !== activeGymId)) {
      throw new NotFoundException('Academia nao encontrada');
    }

    const gym = await this.prisma.gym.findUnique({
      where: { id },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }

    return gym;
  }
}
