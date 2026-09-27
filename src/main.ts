import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ProductionExceptionFilter } from './common/filters/production-exception.filter';
import { assertRuntimeBootstrapContract } from './common/runtime/iron-runtime-environment';

function resolveCorsOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV === 'production' && configured.length === 0) {
    throw new Error('CORS_ORIGINS obrigatorio em producao');
  }

  return configured.length > 0
    ? configured
    : ['http://localhost:3000', 'http://localhost:5173'];
}

function resolveTrustProxyHops(): number {
  const raw = (process.env.TRUST_PROXY_HOPS ?? '0').trim();
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error('TRUST_PROXY_HOPS deve ser inteiro entre 0 e 10');
  }
  return value;
}

async function bootstrap() {
  const runtimeEnvironment = assertRuntimeBootstrapContract();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const trustProxyHops = resolveTrustProxyHops();
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: true });

  const allowedOrigins = new Set(resolveCorsOrigins());
  app.enableCors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );

  if (process.env.NODE_ENV === 'production') {
    app.useGlobalFilters(new ProductionExceptionFilter());
  }

  const port = process.env.PORT || 3333;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    JSON.stringify({
      event: 'service_started',
      service: 'gym-saas-backend',
      port: Number(port),
      runtimeEnvironment,
      nodeEnvironment: process.env.NODE_ENV ?? 'development',
    }),
  );
}

bootstrap();
