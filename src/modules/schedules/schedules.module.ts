import { Module } from '@nestjs/common';
import { SchedulesController } from './schedules.controller';
import { SchedulesReadController } from './schedules-read.controller';
import { SchedulesService } from './schedules.service';
import { SchedulesReadService } from './schedules-read.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [SchedulesController, SchedulesReadController],
  providers: [SchedulesService, SchedulesReadService, PrismaService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
