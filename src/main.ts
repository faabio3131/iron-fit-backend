import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const port = process.env.PORT || 3333;
  await app.listen(port, '0.0.0.0');
  console.log(`Gym SaaS Backend rodando na porta ${port}`);
}
bootstrap();
