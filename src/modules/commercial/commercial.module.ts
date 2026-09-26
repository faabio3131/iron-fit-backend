import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CommercialTrialController } from './commercial-trial.controller';
import { CommercialTrialService } from './commercial-trial.service';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [CommercialTrialController],
  providers: [PrismaService, AuditService, CommercialTrialService],
  exports: [CommercialTrialService],
})
export class CommercialModule {}
