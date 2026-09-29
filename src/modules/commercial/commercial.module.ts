import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CommercialLaunchModule } from '../commercial-launch/commercial-launch.module';
import { CommercialTrialController } from './commercial-trial.controller';
import { CommercialTrialService } from './commercial-trial.service';

@Module({
  imports: [PrismaModule, AuthModule, CommercialLaunchModule],
  controllers: [CommercialTrialController],
  providers: [AuditService, CommercialTrialService],
  exports: [CommercialTrialService],
})
export class CommercialModule {}
