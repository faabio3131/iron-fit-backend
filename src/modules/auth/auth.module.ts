import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { requireJwtSecret } from './auth-security';
import { AuthSecurityService } from './auth-security.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { StepUpService } from './step-up.service';
import { StepUpGuard } from './guards/step-up.guard';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (
        configService: ConfigService,
      ): Promise<JwtModuleOptions> => ({
        secret: requireJwtSecret(configService),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ?? '15m') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSecurityService,
    JwtStrategy,
    LocalStrategy,
    StepUpService,
    StepUpGuard,
    AuditService,
  ],
  exports: [AuthService, AuthSecurityService, StepUpService, StepUpGuard],
})
export class AuthModule {}
