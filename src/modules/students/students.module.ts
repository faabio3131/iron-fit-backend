import { Module } from '@nestjs/common';
import {
  StudentOnboardingController,
  StudentsController,
} from './students.controller';
import { StudentsService } from './students.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';

@Module({
  imports: [ProductEntitlementsModule],
  controllers: [StudentsController, StudentOnboardingController],
  providers: [StudentsService, PrismaService, AuditService],
  exports: [StudentsService],
})
export class StudentsModule {}
