import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AppModule } from './app.module';
import { enableBigIntSerialization } from './common/serialization/bigint';
import { type Env } from './config/env.schema';

enableBigIntSerialization();

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 1_048_576,
    disableRequestLogging: true,
    ignoreTrailingSlash: true,
    maxParamLength: 256,
    genReqId: (req: { headers: Record<string, unknown> }) =>
      (req.headers['x-request-id'] as string) ?? randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    rawBody: false,
  });

  const config = app.get(ConfigService<Env, true>);
  const logger = app.get(Logger);
  app.useLogger(logger);

  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(helmet, { contentSecurityPolicy: false, global: true });
  await app.register(compress, { global: true, threshold: 1_024, encodings: ['br', 'gzip'] });

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }), {
    exclude: ['health/live', 'health/ready'],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.get('API_VERSION', { infer: true }),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Neeliyampathi Pillaiyar Kovil API')
        .setDescription(
          'Management portal API for the temple: accounting, events and the sanththa register',
        )
        .setVersion(config.get('API_VERSION', { infer: true }))
        .addBearerAuth()
        .build(),
    );

    SwaggerModule.setup(`${config.get('API_PREFIX', { infer: true })}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get('PORT', { infer: true });
  const host = config.get('HOST', { infer: true });

  await app.listen(port, host);

  logger.log(
    `API listening on http://${host}:${port}/${config.get('API_PREFIX', { infer: true })}`,
  );
}

void bootstrap();
