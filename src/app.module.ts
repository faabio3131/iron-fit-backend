import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { GymsModule } from './modules/gyms/gyms.module';
import { UsersModule } from './modules/users/users.module';
import { StudentsModule } from './modules/students/students.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';

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
  ],
  controllers: [HealthController],
})
export class AppModule {}
