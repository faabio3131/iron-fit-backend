import { Module } from '@nestjs/common';
import {
  StudentOnboardingController,
  StudentsController,
} from './students.controller';
import { StudentsService } from './students.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [StudentsController, StudentOnboardingController],
  providers: [StudentsService, PrismaService],
  exports: [StudentsService],
})
export class StudentsModule {}
