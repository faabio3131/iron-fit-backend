import { Module } from '@nestjs/common';
import {
  StudentOnboardingController,
  StudentsController,
} from './students.controller';
import { StudentsService } from './students.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../../common/audit/audit.service';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';

@Module({
  imports: [PrismaModule, ProductEntitlementsModule],
  controllers: [StudentsController, StudentOnboardingController],
  providers: [StudentsService, AuditService],
  exports: [StudentsService],
})
export class StudentsModule {}
