import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CommercialTrialController } from './commercial-trial.controller';
import { CommercialTrialService } from './commercial-trial.service';

@Module({
  imports: [ConfigModule],
  controllers: [CommercialTrialController],
  providers: [PrismaService, CommercialTrialService],
  exports: [CommercialTrialService],
})
export class CommercialModule {}
