import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
