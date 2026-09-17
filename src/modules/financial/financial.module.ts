import { Module } from '@nestjs/common';
import { FinancialController } from './financial.controller';
import { FinancialReadController } from './financial-read.controller';
import { FinancialService } from './financial.service';
import { FinancialReadService } from './financial-read.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [FinancialController, FinancialReadController],
  providers: [FinancialService, FinancialReadService, PrismaService],
  exports: [FinancialService],
})
export class FinancialModule {}
