import { Module } from '@nestjs/common';
import { GymsController } from './gyms.controller';
import { GymsService } from './gyms.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [GymsController],
  providers: [GymsService, PrismaService],
  exports: [GymsService],
})
export class GymsModule {}
