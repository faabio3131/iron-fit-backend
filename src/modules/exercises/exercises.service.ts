import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { ExerciseQueryDto } from './dto/exercise-query.dto';

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

    try {
      return await this.prisma.exercise.create({
        data: {
          name: dto.name,
          muscleGroup: dto.muscleGroup,
          movement: dto.movement,
          level: dto.level,
          videoUrl: dto.videoUrl,
          contraindications: dto.contraindications,
        } as any,
      });
    } catch (error) {
      // The unique DB index remains authoritative when concurrent creators
      // both pass the friendly preliminary existence check.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Exercicio ja existe no catalogo');
      }
      throw error;
    }
  }

  async findAll(query: ExerciseQueryDto = {}) {
    const search = query.search?.trim();
    return this.prisma.exercise.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { muscleGroup: { contains: search, mode: 'insensitive' } },
                { movement: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.muscleGroup
          ? { muscleGroup: { equals: query.muscleGroup.trim(), mode: 'insensitive' } }
          : {}),
        ...(query.movement
          ? { movement: { equals: query.movement.trim(), mode: 'insensitive' } }
          : {}),
        ...(query.level
          ? { level: { equals: query.level.trim(), mode: 'insensitive' } }
          : {}),
      },
      include: {
        _count: { select: { workoutExercises: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
}
