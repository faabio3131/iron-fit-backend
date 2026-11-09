import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CommercialLaunchModule } from '../commercial-launch/commercial-launch.module';
import { CommercialTrialController } from './commercial-trial.controller';
import { IronCommercialCheckoutController } from './iron-commercial-checkout.controller';
import { IronCommercialCheckoutService } from './iron-commercial-checkout.service';
import { CommercialTrialService } from './commercial-trial.service';

@Module({
  imports: [PrismaModule, AuthModule, CommercialLaunchModule],
  controllers: [CommercialTrialController, IronCommercialCheckoutController],
  providers: [AuditService, CommercialTrialService, IronCommercialCheckoutService],
  exports: [CommercialTrialService],
})
export class CommercialModule {}
