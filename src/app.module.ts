import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { ConfigModule } from './config/config.module';
import { Env } from './config/env.schema';
import { HealthModule } from './infrastructure/health/health.module';
import { AuditModule } from './infrastructure/audit/audit.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuditReaderModule } from './modules/audit/audit-reader.module';
import { AssetsModule } from './modules/assets/assets.module';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { FinancialYearsModule } from './modules/financial-years/financial-years.module';
import { FixedDepositsModule } from './modules/fixed-deposits/fixed-deposits.module';
import { EventTypesModule } from './modules/event-types/event-types.module';
import { EventsModule } from './modules/events/events.module';
import { FundsModule } from './modules/funds/funds.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { SanththaModule } from './modules/sanththa/sanththa.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { SponsorsModule } from './modules/sponsors/sponsors.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
            (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
          autoLogging: {
            ignore: (req: { originalUrl?: string; url?: string }) =>
              (req.originalUrl ?? req.url ?? '').startsWith('/health'),
          },
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
            remove: true,
          },
          serializers: {
            req: (req: { id: string; method: string; originalUrl?: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.originalUrl ?? req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1_000,
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    SponsorsModule,
    SettingsModule,
    FinancialYearsModule,
    AccountsModule,
    FundsModule,
    ProjectsModule,
    BankAccountsModule,
    VouchersModule,
    LedgerModule,
    FixedDepositsModule,
    AssetsModule,
    ReportsModule,
    EventTypesModule,
    EventsModule,
    SanththaModule,
    NotificationsModule,
    AuditReaderModule,
    SearchModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
  ],
})
export class AppModule {}
