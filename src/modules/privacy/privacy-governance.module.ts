import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivacyGovernanceController } from './privacy-governance.controller';
import { PrivacyGovernanceService } from './privacy-governance.service';

@Module({
  controllers: [PrivacyGovernanceController],
  providers: [
    PrismaService,
    AuditService,
    PrivacyGovernanceService,
  ],
  exports: [PrivacyGovernanceService],
})
export class PrivacyGovernanceModule {}
