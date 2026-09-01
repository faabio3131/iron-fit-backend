import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [ExercisesController],
  providers: [ExercisesService, PrismaService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
