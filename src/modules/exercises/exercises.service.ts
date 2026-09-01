import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';

@Injectable()
export class ExercisesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateExerciseDto) {
    const existing = await this.prisma.exercise.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new ConflictException('Exercicio ja existe no catalogo');
    }

    return this.prisma.exercise.create({
      data: {
        name: dto.name,
        muscleGroup: dto.muscleGroup,
        movement: dto.movement,
        level: dto.level,
        videoUrl: dto.videoUrl,
        contraindications: dto.contraindications,
      } as any,
    });
  }

  async findAll() {
    return this.prisma.exercise.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
