import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../../common/audit/audit.service';

@Module({
  imports: [PrismaModule],
  controllers: [PortalController],
  providers: [PortalService, AuditService],
})
export class PortalModule {}
