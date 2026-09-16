import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiPersistenceService } from './ai-persistence.service';

@Module({
  providers: [PrismaService, AuditService, AiPersistenceService],
  exports: [AiPersistenceService],
})
export class AiModule {}
