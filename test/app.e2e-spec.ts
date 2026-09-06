import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';

import { AppModule } from '../src/app.module';

interface HealthBody {
  status: string;
  info: Record<string, { status: string }>;
}

describe('API (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness without authentication', async () => {
    const response = await request(server).get('/health/live').expect(200);

    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('reports readiness of the database', async () => {
    const response = await request(server).get('/health/ready').expect(200);
    const body = response.body as HealthBody;

    expect(body.info.database.status).toBe('up');
  });

  it('rejects unauthenticated access to a protected route', async () => {
    await request(server).get('/api/user-accounts').expect(401);
  });

  it('rejects malformed credentials before touching the database', async () => {
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);
  });
});
