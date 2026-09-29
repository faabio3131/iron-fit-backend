import { Module } from '@nestjs/common';
import { WorkoutsController, StudentWorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WorkoutsController, StudentWorkoutsController],
  providers: [WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
