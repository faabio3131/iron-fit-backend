import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { PhysicalAccessCoordinator } from './hardware/physical-access-coordinator';
import { PhysicalAccessDriverRegistry } from './hardware/physical-access-driver';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AccessController],
  providers: [AccessService, PhysicalAccessDriverRegistry, PhysicalAccessCoordinator],
  exports: [AccessService, PhysicalAccessCoordinator, PhysicalAccessDriverRegistry],
})
export class AccessModule {}
