import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [PortalController],
  providers: [PortalService, PrismaService],
})
export class PortalModule {}
