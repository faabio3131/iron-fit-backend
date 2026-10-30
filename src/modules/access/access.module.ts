import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { PhysicalAccessCoordinator } from './hardware/physical-access-coordinator';
import { PhysicalAccessDriverRegistry } from './hardware/physical-access-driver';
import { AuthModule } from '../auth/auth.module';
import { PhysicalGatewayController } from './hardware/physical-gateway.controller';
import { PhysicalGatewayService } from './hardware/physical-gateway.service';
import { PhysicalAccessRecoveryService } from './hardware/physical-access-recovery.service';
import { PhysicalDeviceAdminService } from './hardware/physical-device-admin.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AccessController, PhysicalGatewayController],
  providers: [AccessService, PhysicalAccessDriverRegistry, PhysicalAccessCoordinator, PhysicalDeviceAdminService, PhysicalAccessRecoveryService, PhysicalGatewayService],
  exports: [AccessService, PhysicalAccessCoordinator, PhysicalAccessDriverRegistry, PhysicalAccessRecoveryService],
})
export class AccessModule {}
