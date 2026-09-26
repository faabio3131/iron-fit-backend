import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RequestObservabilityMiddleware } from './common/middleware/request-observability.middleware';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { GymsModule } from './modules/gyms/gyms.module';
import { UsersModule } from './modules/users/users.module';
import { StudentsModule } from './modules/students/students.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { EquipmentsModule } from './modules/equipments/equipments.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { AccessModule } from './modules/access/access.module';
import { FinancialModule } from './modules/financial/financial.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PortalModule } from './modules/portal/portal.module';
import { AggregatorModule } from './modules/aggregator/aggregator.module';
import { ProductEntitlementsModule } from './modules/product-entitlements/product-entitlements.module';
import { CreatorNetworkModule } from './modules/creator-network/creator-network.module';
import { AiModule } from './modules/ai/ai.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { SaasBillingModule } from './modules/saas-billing/saas-billing.module';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    GymsModule,
    UsersModule,
    StudentsModule,
    AssessmentsModule,
    EquipmentsModule,
    ExercisesModule,
    WorkoutsModule,
    SchedulesModule,
    AccessModule,
    FinancialModule,
    CommunicationModule,
    DashboardModule,
    PortalModule,
    AggregatorModule,
    ProductEntitlementsModule,
    CreatorNetworkModule,
    AiModule,
    CommercialModule,
    SaasBillingModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService, RequestObservabilityMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestObservabilityMiddleware).forRoutes('*');
  }
}
