import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Import this module instead of registering PrismaService in feature modules.
// Nest shares its exported client and connection pool across all consumers.
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
