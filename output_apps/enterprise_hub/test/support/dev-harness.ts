/**
 * Local harness for the browser tests: the real Access, Auth and Tenants modules on a
 * disposable Postgres, with Redis, SMS and SMTP replaced by in-memory fakes and two stand-in
 * suite controllers (CRM, accounting) protected like the real ones.
 *
 *   DATABASE_* (disposable DB, all migrations applied) HARNESS_PORT=4310 \
 *   npx ts-node -T test/support/dev-harness.ts
 *
 * Never point it at a real database. Sets ALL_MODULES_ENABLED=false so entitlements are exercised.
 */
import './jest-shim';
import 'reflect-metadata';
import { Controller, Get, Post, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from '../../modules/access/access.module';
import { AccessModule as Mod } from '../../modules/access/catalogue';
import { ModuleAccess } from '../../modules/access/decorators';
import { REDIS_CLIENT } from '../../modules/auth/constants/auth.constants';
import { AuthModule } from '../../modules/auth/auth.module';
import { KavenegarService } from '../../modules/auth/services/kavenegar.service';
import { MailService } from '../../modules/auth/services/mail.service';
import { TenantsModule } from '../../modules/tenants/tenants.module';
import { GLOBAL_GUARD_PROVIDERS, globalThrottlerModule } from '../../security/global-guards';
import { FakeRedis } from './fake-redis';

if (!/test|throwaway|e2e|rx_/.test(process.env.DATABASE_NAME ?? '')) {
  throw new Error('dev-harness refuses to run against a database that does not look disposable');
}
process.env.JWT_SECRET ??= 'harness-only-not-a-real-secret';
process.env.ALL_MODULES_ENABLED ??= 'false';
// New organisations start with these modules so the UI has something to show.
process.env.DEFAULT_TENANT_MODULES ??= 'accounting,crm';

@ModuleAccess(Mod.CRM)
@Controller('enterprise-hub/crm')
class HarnessCrm {
  @Get('stats') stats() { return { totalLeads: 0, openLeads: 0, openPipelineValue: 0, wonRevenue: 0 }; }
  @Post('leads') create() { return { ok: true }; }
}
@ModuleAccess(Mod.ACCOUNTING)
@Controller('enterprise-hub/accounting')
class HarnessAccounting {
  @Get('trial-balance') tb() { return { rows: [], totalDebit: 0, totalCredit: 0, balanced: true }; }
}

const fakeMail = {
  sendPasswordReset: async () => true,
  sendSecurityAlert: async () => true,
  portalUrl: () => process.env.HARNESS_PORTAL_URL ?? 'http://127.0.0.1:3911',
  sendInvitation: async (to: string, link: string) => {
    console.log(`[harness] invitation for ${to}: ${link}`);
    return true;
  },
};

@Module({
  controllers: [HarnessCrm, HarnessAccounting],
  providers: GLOBAL_GUARD_PROVIDERS,
  imports: [
    globalThrottlerModule,
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.DATABASE_PORT ?? 5432),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      autoLoadEntities: true,
      synchronize: false,
    }),
    AccessModule,
    AuthModule,
    TenantsModule,
  ],
})
class HarnessModule {}

async function boot() {
  const { Test } = await import('@nestjs/testing');
  const ref = await Test.createTestingModule({ imports: [HarnessModule] })
    .overrideProvider(REDIS_CLIENT).useValue(new FakeRedis())
    .overrideProvider(KavenegarService).useValue({ sendVerificationCode: async () => true, templateFor: () => 't' })
    .overrideProvider(MailService).useValue(fakeMail)
    .compile();
  const app = ref.createNestApplication();
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', true);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const port = Number(process.env.HARNESS_PORT ?? 4310);
  await app.listen(port, '127.0.0.1');
  console.log(`[harness] listening on http://127.0.0.1:${port}`);
}
boot().catch((e) => {
  console.error(e);
  process.exit(1);
});
