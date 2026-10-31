/**
 * HTTP-level tests for password auth against a REAL Postgres.
 * Requires a disposable database that already has all migrations applied
 * (see test/migrations/verify-password-auth-migration.sh) and DATABASE_* env.
 * Redis, SMS and SMTP are replaced by in-memory fakes.
 */
import 'reflect-metadata';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { REDIS_CLIENT } from '../modules/auth/constants/auth.constants';
import { AccessModule } from '../modules/access/access.module';
import { AuthModule } from '../modules/auth/auth.module';
import { KavenegarService } from '../modules/auth/services/kavenegar.service';
import { MailService } from '../modules/auth/services/mail.service';
import { TenantsModule } from '../modules/tenants/tenants.module';
import { GLOBAL_GUARD_PROVIDERS, globalThrottlerModule } from '../security/global-guards';
import { FakeRedis } from './support/fake-redis';

const hasDb = Boolean(process.env.DATABASE_PASSWORD && process.env.DATABASE_NAME);
const suite = hasDb ? describe : describe.skip;

const PW = 'a-long-unusual-pass';
let ipCounter = 0;
/** A fresh client IP per test so the per-IP throttler of one test never leaks into another. */
const freshIp = () => `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter += 1) % 250}`;

suite('Password auth (e2e, real Postgres)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sms = { sendVerificationCode: jest.fn(async () => true), templateFor: () => 'roxira-verify' };
  const resetTokens: string[] = [];
  const mail = {
    sendPasswordReset: jest.fn(async (_to: string, token: string) => {
      resetTokens.push(token);
      return true;
    }),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-only-not-a-real-secret';
    const moduleRef = await Test.createTestingModule({
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
      .overrideProvider(REDIS_CLIENT)
      .useValue(new FakeRedis())
      .overrideProvider(KavenegarService)
      .useValue(sms)
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();

    app = moduleRef.createNestApplication();
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', true);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    await dataSource.query(`DELETE FROM users WHERE username LIKE 'e2e-%' OR login_email LIKE 'e2e-%' OR phone LIKE '0919%'`);
  });

  afterAll(async () => {
    await app?.close();
  });

  const api = (ip: string) => ({
    post: (path: string) => request(app.getHttpServer()).post(`/v1/auth/${path}`).set('X-Forwarded-For', ip),
    get: (path: string) => request(app.getHttpServer()).get(path).set('X-Forwarded-For', ip),
  });

  const signup = (ip: string, name: string, org?: string) =>
    api(ip).post('signup').send({ username: `e2e-${name}`, email: `e2e-${name}@example.com`, password: PW, organizationName: org });

  it('signup creates the account, its own tenant, and a working session', async () => {
    const ip = freshIp();
    const res = await signup(ip, 'alice', 'Alice Corp').expect(201);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(res.body.refreshToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|scrypt/);

    const me = await api(ip).get('/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ username: 'e2e-alice', email: 'e2e-alice@example.com', phone: null, hasPassword: true });

    const tenant = await api(ip).get('/v1/tenants/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(tenant.body.name).toBe('Alice Corp');
    const row = (await dataSource.query(`SELECT tenant_id, tenant_role, password_hash FROM users WHERE username='e2e-alice'`))[0];
    expect(row.tenant_role).toBe('OWNER');
    expect(row.tenant_id).toBe(tenant.body.id);
    expect(row.password_hash).toMatch(/^scrypt\$/);
  });

  it('keeps tenants isolated between two signups', async () => {
    const a = await signup(freshIp(), 'iso-a', 'Org A').expect(201);
    const b = await signup(freshIp(), 'iso-b', 'Org B').expect(201);
    const ta = await request(app.getHttpServer()).get('/v1/tenants/me').set('Authorization', `Bearer ${a.body.accessToken}`).expect(200);
    const tb = await request(app.getHttpServer()).get('/v1/tenants/me').set('Authorization', `Bearer ${b.body.accessToken}`).expect(200);
    expect(ta.body.id).not.toBe(tb.body.id);
    expect([ta.body.name, tb.body.name]).toEqual(['Org A', 'Org B']);
    const members = await request(app.getHttpServer()).get('/v1/tenants/members').set('Authorization', `Bearer ${a.body.accessToken}`);
    if (members.status === 200) {
      expect(JSON.stringify(members.body)).not.toContain('iso-b');
    }
  });

  it('answers a duplicate signup with a generic 409 and rejects weak or unknown fields', async () => {
    const ip = freshIp();
    await signup(ip, 'dup').expect(201);
    const dup = await signup(ip, 'dup').expect(409);
    expect(dup.body.message).toMatch(/Could not create the account/);
    await api(ip).post('signup').send({ username: 'e2e-weak', password: 'short' }).expect(400);
    await api(ip).post('signup').send({ username: 'e2e-extra', password: PW, role: 'ADMIN' }).expect(400);
    await api(ip).post('signup').send({ password: PW }).expect(400);
  });

  it('logs in by email or username; wrong password, unknown user look identical', async () => {
    const ip = freshIp();
    await signup(ip, 'login').expect(201);
    await api(ip).post('login').send({ identifier: 'E2E-Login@example.com', password: PW }).expect(200);
    await api(ip).post('login').send({ identifier: 'e2e-login', password: PW }).expect(200);
    const wrong = await api(ip).post('login').send({ identifier: 'e2e-login', password: 'not-the-password' }).expect(401);
    const unknown = await api(ip).post('login').send({ identifier: 'e2e-nobody-here', password: PW }).expect(401);
    expect(wrong.body.message).toBe('Invalid username/email or password.');
    expect(unknown.body).toEqual(wrong.body);
  });

  it('rate-limits login: the IP throttler answers 429 after 5 requests in a minute', async () => {
    const ip = freshIp();
    await signup(freshIp(), 'rate').expect(201);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await api(ip).post('login').send({ identifier: 'e2e-rate', password: 'wrong-password-123' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
    // a throttled client is also refused the right password
    await api(ip).post('login').send({ identifier: 'e2e-rate', password: PW }).expect(429);
  });

  it('failures from one IP do not lock the real owner out from another IP', async () => {
    await signup(freshIp(), 'lock').expect(201);
    const attacker = freshIp();
    for (let i = 0; i < 5; i += 1) {
      await api(attacker).post('login').send({ identifier: 'e2e-lock', password: 'wrong-password-123' }).expect(401);
    }
    await api(freshIp()).post('login').send({ identifier: 'e2e-lock', password: PW }).expect(200);
    // per-identifier lockout (5 per IP, 20 total) is covered in password-auth.service.spec.ts
  });

  it('reset flow: generic answer, one-time token, old password dead, old sessions revoked', async () => {
    const ip = freshIp();
    const first = await signup(ip, 'reset').expect(201);
    const known = await api(ip).post('password/forgot').send({ identifier: 'e2e-reset@example.com', locale: 'en' }).expect(200);
    const unknown = await api(ip).post('password/forgot').send({ identifier: 'e2e-ghost@example.com' }).expect(200);
    expect(unknown.body).toEqual(known.body);
    expect(resetTokens.length).toBeGreaterThan(0);
    const token = resetTokens[resetTokens.length - 1];

    await api(ip).post('password/reset').send({ token, newPassword: 'short' }).expect(400);
    await api(ip).post('password/reset').send({ token, newPassword: 'a-brand-new-passphrase' }).expect(200);
    await api(ip).post('password/reset').send({ token, newPassword: 'another-new-passphrase' }).expect(400);
    await api(ip).post('password/reset').send({ token: 'q'.repeat(43), newPassword: 'another-new-passphrase' }).expect(400);

    await api(ip).post('login').send({ identifier: 'e2e-reset', password: PW }).expect(401);
    await api(ip).post('login').send({ identifier: 'e2e-reset', password: 'a-brand-new-passphrase' }).expect(200);
    await api(ip).post('refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
  });

  it('refresh rotates, replay kills the family, logout revokes on the server', async () => {
    const ip = freshIp();
    const s = await signup(ip, 'refresh').expect(201);
    const r1 = await api(ip).post('refresh').send({ refreshToken: s.body.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(s.body.refreshToken);
    expect(r1.body.user.id).toBe(s.body.user.id);

    await api(ip).post('refresh').send({ refreshToken: s.body.refreshToken }).expect(401); // replay
    await api(ip).post('refresh').send({ refreshToken: r1.body.refreshToken }).expect(401); // family revoked

    const again = await api(ip).post('login').send({ identifier: 'e2e-refresh', password: PW }).expect(200);
    await api(ip).post('logout').send({ refreshToken: again.body.refreshToken }).expect(204);
    await api(ip).post('logout').send({ refreshToken: again.body.refreshToken }).expect(204); // idempotent
    await api(ip).post('refresh').send({ refreshToken: again.body.refreshToken }).expect(401);
  });

  it('an SMS user sets a password and both methods open the same account', async () => {
    const ip = freshIp();
    const phone = '09190000001';
    sms.sendVerificationCode.mockClear();
    await api(ip).post('send-otp').send({ phone }).expect(200);
    const code = (sms.sendVerificationCode.mock.calls[0] as unknown as string[])[1];
    const otp = await api(ip).post('verify-otp').send({ phone, code, organizationName: 'Phone Org' }).expect(200);
    expect(otp.body.user.hasPassword).toBe(false);
    expect(otp.body.refreshToken).toBeTruthy();

    await api(ip).post('password/set').send({ newPassword: PW, email: 'e2e-phone@example.com' }).expect(401); // needs a session
    const set = await api(ip)
      .post('password/set')
      .set('Authorization', `Bearer ${otp.body.accessToken}`)
      .send({ newPassword: PW, email: 'e2e-phone@example.com' })
      .expect(200);
    expect(set.body.user.id).toBe(otp.body.user.id);

    const viaPassword = await api(ip).post('login').send({ identifier: 'e2e-phone@example.com', password: PW }).expect(200);
    expect(viaPassword.body.user.id).toBe(otp.body.user.id);
    expect(viaPassword.body.user.phone).toBe(phone);
    const t1 = await request(app.getHttpServer()).get('/v1/tenants/me').set('Authorization', `Bearer ${viaPassword.body.accessToken}`).expect(200);
    const t2 = await request(app.getHttpServer()).get('/v1/tenants/me').set('Authorization', `Bearer ${otp.body.accessToken}`).expect(200);
    expect(t1.body.id).toBe(t2.body.id);
    expect(t1.body.name).toBe('Phone Org');
  });

  it('reports an SMS delivery failure as 503 with a machine-readable code', async () => {
    const ip = freshIp();
    sms.sendVerificationCode.mockResolvedValueOnce(false);
    const res = await api(ip).post('send-otp').send({ phone: '09190000002' }).expect(503);
    expect(res.body).toMatchObject({ code: 'SMS_DELIVERY_FAILED' });
    expect(res.body.message).toMatch(/password/i);
  });

  it('protects the authenticated endpoints', async () => {
    const ip = freshIp();
    await api(ip).get('/v1/auth/me').expect(401);
    await api(ip).post('password/set').send({ newPassword: PW, email: 'e2e-x@example.com' }).expect(401);
  });
});
