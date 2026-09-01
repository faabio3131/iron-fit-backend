import { Module } from '@nestjs/common';
import { WorkoutsController, StudentWorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [WorkoutsController, StudentWorkoutsController],
  providers: [WorkoutsService, PrismaService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
