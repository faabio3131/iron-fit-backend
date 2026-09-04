import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AggregatorAgreementsController } from './agreements/aggregator-agreements.controller';
import { AggregatorAgreementsService } from './agreements/aggregator-agreements.service';

@Module({
  controllers: [AggregatorAgreementsController],
  providers: [AggregatorAgreementsService, PrismaService, AuditService],
  exports: [AggregatorAgreementsService],
})
export class AggregatorModule {}
