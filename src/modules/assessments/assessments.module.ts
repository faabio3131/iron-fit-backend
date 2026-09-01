import { Module } from '@nestjs/common';
import { AssessmentsController, AssessmentsByIdController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [AssessmentsController, AssessmentsByIdController],
  providers: [AssessmentsService, PrismaService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
