import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrivacyGovernanceController } from './privacy-governance.controller';
import { PrivacyGovernanceService } from './privacy-governance.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrivacyGovernanceController],
  providers: [
    AuditService,
    PrivacyGovernanceService,
  ],
  exports: [PrivacyGovernanceService],
})
export class PrivacyGovernanceModule {}
