import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateGymDto } from './dto/create-gym.dto';

@Injectable()
export class GymsService {
  private readonly audit: AuditService;

  constructor(private prisma: PrismaService) {
    this.audit = new AuditService(prisma);
  }

  async create(dto: CreateGymDto, actorUserId?: string) {
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

    await this.audit.record({
      gymId: gym.id,
      userId: actorUserId ?? null,
      action: 'GYM_CREATED',
      entity: 'Gym',
      entityId: gym.id,
      next: {
        slug: gym.slug,
        timezone: gym.timezone,
        active: gym.active,
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
