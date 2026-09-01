import { Module } from '@nestjs/common';
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [FinancialController],
  providers: [FinancialService, PrismaService],
  exports: [FinancialService],
})
export class FinancialModule {}
