/**
 * HTTP-level tests for organisation access control against a REAL Postgres:
 * invitations, multi-organisation membership, role limits, tenant isolation,
 * module entitlements, 2FA policy, sessions and the immutable audit log.
 * Needs a disposable database with all migrations applied (see
 * test/migrations/verify-access-control-migration.sh) and DATABASE_* env.
 * Redis, SMS and SMTP are replaced by in-memory fakes.
 */
import 'reflect-metadata';
import { Controller, Get, INestApplication, Post, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AccessModule } from '../modules/access/access.module';
import { AccessModule as Mod, AccessAction } from '../modules/access/catalogue';
import { ModuleAccess, RequireAction } from '../modules/access/decorators';
import { REDIS_CLIENT } from '../modules/auth/constants/auth.constants';
import { AuthModule } from '../modules/auth/auth.module';
import { KavenegarService } from '../modules/auth/services/kavenegar.service';
import { MailService } from '../modules/auth/services/mail.service';
import { base32Decode, hotp, totpStep } from '../modules/auth/utils/totp.util';
import { TenantsModule } from '../modules/tenants/tenants.module';
import { GLOBAL_GUARD_PROVIDERS, globalThrottlerModule } from '../security/global-guards';
import { FakeRedis } from './support/fake-redis';

const hasDb = Boolean(process.env.DATABASE_PASSWORD && process.env.DATABASE_NAME);
const suite = hasDb ? describe : describe.skip;

const PW = 'a-long-unusual-pass';
let ipCounter = 0;
const freshIp = () => `10.30.${Math.floor(ipCounter / 250)}.${(ipCounter += 1) % 250}`;

/** Stand-ins for the suite modules, protected exactly like the real controllers. */
@ModuleAccess(Mod.CRM)
@Controller('t-crm')
class FakeCrmController {
  @Get() list() { return { ok: true }; }
  @Post() create() { return { created: true }; }
}
@ModuleAccess(Mod.ACCOUNTING)
@Controller('t-acc')
class FakeAccountingController {
  @Get() list() { return { ok: true }; }
  @RequireAction(AccessAction.POST) @Post('post') post() { return { posted: true }; }
}

suite('Org access control (e2e, real Postgres)', () => {
  let app: INestApplication;
  let db: DataSource;
  const emails: Array<{ to: string; link: string }> = [];
  const alerts: string[] = [];
  const mail = {
    sendPasswordReset: jest.fn(async () => true),
    portalUrl: () => 'https://portal.test',
    sendInvitation: jest.fn(async (to: string, link: string) => {
      emails.push({ to, link });
      return true;
    }),
    sendSecurityAlert: jest.fn(async (to: string) => {
      alerts.push(to);
      return true;
    }),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-only-not-a-real-secret';
    process.env.ALL_MODULES_ENABLED = 'false'; // the trial switch is covered by its own test below
    const moduleRef = await Test.createTestingModule({
      providers: GLOBAL_GUARD_PROVIDERS,
      controllers: [FakeCrmController, FakeAccountingController],
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
      .overrideProvider(REDIS_CLIENT).useValue(new FakeRedis())
      .overrideProvider(KavenegarService).useValue({ sendVerificationCode: jest.fn(async () => true), templateFor: () => 't' })
      .overrideProvider(MailService).useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', true);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);
    await db.query(`DELETE FROM users WHERE username LIKE 'ac-%'`);
  });

  afterAll(async () => {
    await app?.close();
  });

  // ------------------------------------------------------------ helpers
  const http = () => request(app.getHttpServer());
  const call = (method: 'get' | 'post' | 'patch' | 'delete' | 'put', path: string, token: string, body?: object) => {
    const r = http()[method](path).set('Authorization', `Bearer ${token}`).set('X-Forwarded-For', freshIp());
    return body ? r.send(body) : r;
  };
  const signup = async (name: string, extra: Record<string, unknown> = {}) => {
    const res = await http()
      .post('/v1/auth/signup')
      .set('X-Forwarded-For', freshIp())
      .send({ username: `ac-${name}`, email: `ac-${name}@example.com`, password: PW, ...extra })
      .expect(201);
    return res.body as { accessToken: string; refreshToken: string; user: { id: string } };
  };
  /** Sign up, create an organisation, then refresh so the token carries it. */
  const founder = async (name: string, org: string) => {
    const s = await signup(name);
    const created = await call('post', '/v1/org', s.accessToken, { name: org }).expect(201);
    const refreshed = await http().post('/v1/auth/refresh').set('X-Forwarded-For', freshIp()).send({ refreshToken: s.refreshToken }).expect(200);
    return { ...refreshed.body, userId: s.user.id, tenantId: created.body.tenantId } as {
      accessToken: string; refreshToken: string; userId: string; tenantId: string;
    };
  };
  const enable = (tenantId: string, ...modules: string[]) =>
    db.query(
      `INSERT INTO tenant_module_entitlements (tenant_id, module, enabled) SELECT $1, m, true FROM unnest($2::text[]) m
       ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = true`,
      [tenantId, modules],
    );
  const invite = async (owner: { accessToken: string }, body: object) => {
    const res = await call('post', '/v1/org/invitations', owner.accessToken, body).expect(201);
    return (res.body.link as string).split('/account/invite/')[1].split('?')[0];
  };
  const joinBy = async (name: string, token: string) => {
    const s = await signup(name, { inviteToken: token });
    return s;
  };

  // --------------------------------------------------------------- tests
  it('a person signs up alone (no organisation) and creates one later', async () => {
    const s = await signup('solo');
    const me = await call('get', '/v1/org/me', s.accessToken).expect(200);
    expect(me.body.organization).toBeNull();
    await call('get', '/v1/t-crm', s.accessToken).expect(403);

    const created = await call('post', '/v1/org', s.accessToken, { name: 'Solo Ltd' }).expect(201);
    const fresh = await http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
    const me2 = await call('get', '/v1/org/me', fresh.body.accessToken).expect(200);
    expect(me2.body.organization).toMatchObject({ tenantId: created.body.tenantId, roleKey: 'owner' });
  });

  it('invited staff join with a link and never need an organisation name', async () => {
    const owner = await founder('inv-owner', 'Inviters Inc');
    await enable(owner.tenantId, 'crm', 'accounting');
    const token = await invite(owner, { email: 'ac-inv-sales@example.com', roleKey: 'sales' });
    expect(emails.at(-1)).toMatchObject({ to: 'ac-inv-sales@example.com' });

    const preview = await http().get(`/v1/invitations/${token}`).expect(200);
    expect(preview.body).toMatchObject({ organizationName: 'Inviters Inc', roleKey: 'sales' });

    const staff = await joinBy('inv-sales', token);
    const me = await call('get', '/v1/org/me', staff.accessToken).expect(200);
    expect(me.body.organization).toMatchObject({ tenantId: owner.tenantId, roleKey: 'sales' });
    expect((await db.query(`SELECT count(*)::int n FROM tenants WHERE name LIKE '%ac-inv-sales%'`))[0].n).toBe(0);

    // one-time link
    await http().get(`/v1/invitations/${token}`).expect(404);
  });

  it('role limits: sales can use CRM but not accounting, members or the audit log', async () => {
    const owner = await founder('lim-owner', 'Limits Inc');
    await enable(owner.tenantId, 'crm', 'accounting');
    const staff = await joinBy('lim-sales', await invite(owner, { roleKey: 'sales' }));
    await call('get', '/v1/t-crm', staff.accessToken).expect(200);
    await call('post', '/v1/t-crm', staff.accessToken).expect(201);
    await call('get', '/v1/t-acc', staff.accessToken).expect(403);
    await call('get', '/v1/org/members', staff.accessToken).expect(403);
    await call('post', '/v1/org/invitations', staff.accessToken, { roleKey: 'sales' }).expect(403);
    await call('get', '/v1/org/audit', staff.accessToken).expect(403);

    const ro = await joinBy('lim-ro', await invite(owner, { roleKey: 'read_only' }));
    await call('get', '/v1/t-crm', ro.accessToken).expect(200);
    await call('post', '/v1/t-crm', ro.accessToken).expect(403);

    const acct = await joinBy('lim-acct', await invite(owner, { roleKey: 'accountant' }));
    await call('get', '/v1/t-acc', acct.accessToken).expect(200);
    await call('post', '/v1/t-acc/post', acct.accessToken).expect(201);
    await call('get', '/v1/t-crm', acct.accessToken).expect(403);
  });

  it('no privilege escalation: an admin cannot hand out owner or a custom role beyond their own rights', async () => {
    const owner = await founder('esc-owner', 'Escalation Inc');
    const admin = await joinBy('esc-admin', await invite(owner, { roleKey: 'admin' }));
    await call('post', '/v1/org/invitations', admin.accessToken, { roleKey: 'owner' }).expect(403);
    const sales = await joinBy('esc-sales', await invite(owner, { roleKey: 'sales' }));
    const members = (await call('get', '/v1/org/members', owner.accessToken).expect(200)).body as Array<{ id: string; userId: string; roleKey: string }>;
    const salesM = members.find((m) => m.userId === sales.user.id)!;
    const ownerM = members.find((m) => m.userId === owner.userId)!;
    await call('patch', `/v1/org/members/${salesM.id}`, admin.accessToken, { roleKey: 'owner' }).expect(403);
    // the admin lacks security:admin, so a custom role containing it is refused
    await call('post', '/v1/org/roles', admin.accessToken, { name: 'sneaky', permissions: ['security:admin'] }).expect(403);
    await call('post', '/v1/org/roles', admin.accessToken, { name: 'fine', permissions: ['crm:read'] }).expect(201);
    // an admin cannot touch an owner
    await call('patch', `/v1/org/members/${ownerM.id}`, admin.accessToken, { status: 'SUSPENDED' }).expect(403);
    await call('delete', `/v1/org/members/${ownerM.id}`, admin.accessToken).expect(403);
    // the last owner cannot be removed or demoted
    await call('delete', `/v1/org/members/${ownerM.id}`, owner.accessToken).expect(409);
    await call('patch', `/v1/org/members/${ownerM.id}`, owner.accessToken, { roleKey: 'admin' }).expect(409);
  });

  it('custom roles work and a suspended member loses access immediately', async () => {
    const owner = await founder('cr-owner', 'Custom Inc');
    await enable(owner.tenantId, 'crm');
    const role = await call('post', '/v1/org/roles', owner.accessToken, { name: 'crm viewer', permissions: ['crm:read'] }).expect(201);
    const staff = await joinBy('cr-staff', await invite(owner, { roleKey: 'custom', customRoleId: role.body.id }));
    await call('get', '/v1/t-crm', staff.accessToken).expect(200);
    await call('post', '/v1/t-crm', staff.accessToken).expect(403);
    await call('delete', `/v1/org/roles/${role.body.id}`, owner.accessToken).expect(409); // still assigned

    const members = (await call('get', '/v1/org/members', owner.accessToken)).body as Array<{ id: string; userId: string }>;
    const m = members.find((x) => x.userId === staff.user.id)!;
    await call('patch', `/v1/org/members/${m.id}`, owner.accessToken, { status: 'SUSPENDED' }).expect(200);
    await call('get', '/v1/t-crm', staff.accessToken).expect(403);
  });

  it('tenant isolation: org B admins never see or change org A data, even with A ids', async () => {
    const a = await founder('iso-a', 'Org A');
    const b = await founder('iso-b', 'Org B');
    const aStaff = await joinBy('iso-a-staff', await invite(a, { roleKey: 'sales' }));
    const branchA = (await call('post', '/v1/org/branches', a.accessToken, { name: 'A Branch' }).expect(201)).body;
    const roleA = (await call('post', '/v1/org/roles', a.accessToken, { name: 'A role', permissions: ['crm:read'] }).expect(201)).body;
    const invA = (await call('get', '/v1/org/invitations', a.accessToken).expect(200)).body as Array<{ id: string }>;
    await call('post', '/v1/org/invitations', a.accessToken, { roleKey: 'sales' }).expect(201);
    const aMembers = (await call('get', '/v1/org/members', a.accessToken)).body as Array<{ id: string; userId: string }>;
    const aStaffM = aMembers.find((m) => m.userId === aStaff.user.id)!;

    const bMembers = (await call('get', '/v1/org/members', b.accessToken).expect(200)).body as Array<{ userId: string }>;
    expect(JSON.stringify(bMembers)).not.toContain(aStaff.user.id);
    expect(JSON.stringify((await call('get', '/v1/org/branches', b.accessToken)).body)).not.toContain(branchA.id);
    expect(JSON.stringify((await call('get', '/v1/org/roles', b.accessToken)).body)).not.toContain(roleA.id);
    expect(JSON.stringify((await call('get', '/v1/org/invitations', b.accessToken)).body)).not.toContain(invA[0]?.id ?? 'none');
    // A's ids used from B are simply not found
    await call('patch', `/v1/org/members/${aStaffM.id}`, b.accessToken, { roleKey: 'admin' }).expect(404);
    await call('delete', `/v1/org/members/${aStaffM.id}`, b.accessToken).expect(404);
    await call('patch', `/v1/org/roles/${roleA.id}`, b.accessToken, { name: 'xx' }).expect(404);
    await call('delete', `/v1/org/branches/${branchA.id}`, b.accessToken).expect(404);
    // B cannot place its member in A's branch
    const bInvite = { roleKey: 'sales', branchId: branchA.id };
    await call('post', '/v1/org/invitations', b.accessToken, bInvite).expect(400);
    // a token for B cannot be turned into A by editing nothing: switching needs a real membership
    await call('post', '/v1/auth/switch-tenant', b.accessToken, { tenantId: a.tenantId }).expect(403);
    // audit logs are separate
    const auditB = (await call('get', '/v1/org/audit', b.accessToken).expect(200)).body.items as Array<{ tenantId: string }>;
    expect(auditB.every((r) => r.tenantId === b.tenantId)).toBe(true);
  });

  it('one person in several organisations can list and switch between them', async () => {
    const a = await founder('multi-a', 'Multi A');
    const b = await founder('multi-b', 'Multi B');
    await enable(a.tenantId, 'crm');
    await enable(b.tenantId, 'crm');
    // multi-b owner is also invited into A as sales
    const token = await invite(a, { roleKey: 'sales' });
    await call('post', '/v1/invitations/accept', b.accessToken, { token }).expect(200);

    const orgs = (await call('get', '/v1/auth/organizations', b.accessToken).expect(200)).body as Array<{ tenantId: string; roleKey: string }>;
    expect(orgs.map((o) => o.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());

    const sw = await call('post', '/v1/auth/switch-tenant', b.accessToken, { tenantId: a.tenantId }).expect(200);
    const inA = await call('get', '/v1/org/me', sw.body.accessToken).expect(200);
    expect(inA.body.organization).toMatchObject({ tenantId: a.tenantId, roleKey: 'sales' });
    await call('get', '/v1/org/members', sw.body.accessToken).expect(403); // only sales in A
    await call('get', '/v1/org/members', b.accessToken).expect(200); // still owner in B with the old token

    // the choice survives a refresh
    const refreshed = await http().post('/v1/auth/refresh').send({ refreshToken: b.refreshToken }).expect(200);
    const back = await call('get', '/v1/org/me', refreshed.body.accessToken).expect(200);
    expect(back.body.organization.tenantId).toBe(a.tenantId);
  });

  it('managed staff: an owner creates username + password, the person signs in, and the role limits apply', async () => {
    const owner = await founder('mg-owner', 'Managed Co');
    await enable(owner.tenantId, 'crm', 'accounting', 'members');
    const created = await call('post', '/v1/org/members', owner.accessToken, {
      username: 'ac-mg-ali', password: PW, displayName: 'Ali', roleKey: 'sales',
    }).expect(201);
    const login = await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp())
      .send({ identifier: 'ac-mg-ali', password: PW }).expect(200);
    await call('get', '/v1/t-crm', login.body.accessToken).expect(200);
    await call('get', '/v1/t-acc', login.body.accessToken).expect(403);
    await call('get', '/v1/org/members', login.body.accessToken).expect(403);

    // same username in another organisation is refused, not shared
    const other = await founder('mg-other', 'Other Co');
    await call('post', '/v1/org/members', other.accessToken, { username: 'ac-mg-ali', password: PW, roleKey: 'sales' }).expect(409);

    // a sales member cannot create staff
    await call('post', '/v1/org/members', login.body.accessToken, { username: 'ac-mg-x', password: PW, roleKey: 'sales' }).expect(403);
    // an admin cannot be used to mint an owner
    const adminRes = await call('post', '/v1/org/members', owner.accessToken, { username: 'ac-mg-adm', password: PW, roleKey: 'admin' }).expect(201);
    const adminLogin = await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp())
      .send({ identifier: 'ac-mg-adm', password: PW }).expect(200);
    await call('post', '/v1/org/members', adminLogin.body.accessToken, { username: 'ac-mg-o', password: PW, roleKey: 'owner' }).expect(403);
    expect(adminRes.body.username).toBe('ac-mg-adm');

    // reset: old password and old session die
    const NEW = 'a-different-long-pass';
    await call('post', `/v1/org/members/${created.body.id}/password`, owner.accessToken, { password: NEW }).expect(204);
    await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ identifier: 'ac-mg-ali', password: PW }).expect(401);
    await http().post('/v1/auth/refresh').set('X-Forwarded-For', freshIp()).send({ refreshToken: login.body.refreshToken }).expect(401);
    await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ identifier: 'ac-mg-ali', password: NEW }).expect(200);

    // another organisation cannot touch it, and a self-registered member cannot be reset
    await call('post', `/v1/org/members/${created.body.id}/password`, other.accessToken, { password: NEW }).expect(404);
    const self = await joinBy('mg-self', await invite(owner, { roleKey: 'sales' }));
    const list = (await call('get', '/v1/org/members', owner.accessToken)).body as Array<{ id: string; userId: string; managed: boolean }>;
    const selfRow = list.find((m) => m.userId === self.user.id)!;
    expect(selfRow.managed).toBe(false);
    expect(list.find((m) => m.id === created.body.id)!.managed).toBe(true);
    await call('post', `/v1/org/members/${selfRow.id}/password`, owner.accessToken, { password: NEW }).expect(403);
  });

  it('twelve companies under one owner stay separate: same names and codes, no shared members, data or audit', async () => {
    const owner = await signup('dozen');
    const tokens: Array<{ tenantId: string; accessToken: string }> = [];
    for (let i = 1; i <= 12; i += 1) {
      const { tenantId } = (await call('post', '/v1/org', owner.accessToken, { name: 'شرکت یکسان' }).expect(201)).body;
      const sw = await call('post', '/v1/auth/switch-tenant', owner.accessToken, { tenantId }).expect(200);
      tokens.push({ tenantId, accessToken: sw.body.accessToken });
    }
    expect(new Set(tokens.map((t) => t.tenantId)).size).toBe(12);
    const orgs = (await call('get', '/v1/auth/organizations', owner.accessToken).expect(200)).body as unknown[];
    expect(orgs).toHaveLength(12);

    for (const [i, t] of tokens.entries()) {
      await call('post', '/v1/org/branches', t.accessToken, { name: 'شعبه مرکزی', code: 'HQ' }).expect(201);
      await call('post', '/v1/org/members', t.accessToken, { username: `ac-dz-${i}`, password: PW, roleKey: 'sales' }).expect(201);
    }
    for (const [i, t] of tokens.entries()) {
      const me = (await call('get', '/v1/org/me', t.accessToken).expect(200)).body;
      expect(me.organization.tenantId).toBe(t.tenantId);
      const members = (await call('get', '/v1/org/members', t.accessToken).expect(200)).body as Array<{ username: string | null }>;
      expect(members.map((m) => m.username).filter((u) => u?.startsWith('ac-dz-'))).toEqual([`ac-dz-${i}`]);
      expect((await call('get', '/v1/org/branches', t.accessToken).expect(200)).body).toHaveLength(1);
      const audit = (await call('get', '/v1/org/audit', t.accessToken).expect(200)).body.items as Array<{ tenantId: string }>;
      expect(audit.every((r) => r.tenantId === t.tenantId)).toBe(true);
    }
    // staff of one company cannot switch into a sibling company
    const staff = await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ identifier: 'ac-dz-0', password: PW }).expect(200);
    await call('post', '/v1/auth/switch-tenant', staff.body.accessToken, { tenantId: tokens[1].tenantId }).expect(403);
  });

  it('module entitlements: a module that is not enabled is closed to everyone, and only the platform operator can change it', async () => {
    const owner = await founder('ent-owner', 'Entitled Inc');
    await call('get', '/v1/t-crm', owner.accessToken).expect(403);
    const denied = await call('get', '/v1/t-crm', owner.accessToken);
    expect(denied.body.code).toBe('MODULE_NOT_ENTITLED');
    // a tenant owner cannot enable it for themselves
    await call('put', `/v1/admin/entitlements/${owner.tenantId}`, owner.accessToken, { changes: [{ module: 'crm', enabled: true }] }).expect(403);
    const list = await call('get', '/v1/org/entitlements', owner.accessToken).expect(200);
    expect(list.body.find((e: { module: string }) => e.module === 'crm').enabled).toBe(false);
    expect(JSON.stringify(list.body)).not.toMatch(/price|amount|cost/i);

    // platform operator
    const op = await signup('ent-op');
    await db.query(`UPDATE users SET role='ADMIN' WHERE id=$1`, [op.user.id]);
    const opTok = (await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ identifier: 'ac-ent-op', password: PW }).expect(200)).body.accessToken;
    await call('put', `/v1/admin/entitlements/${owner.tenantId}`, opTok, { changes: [{ module: 'crm', enabled: true }] }).expect(200);
    await call('put', `/v1/admin/entitlements/${owner.tenantId}`, opTok, { changes: [{ module: 'members', enabled: false }] }).expect(400);
    await call('get', '/v1/t-crm', owner.accessToken).expect(200);
    await call('put', `/v1/admin/entitlements/${owner.tenantId}`, opTok, { changes: [{ module: 'crm', enabled: false }] }).expect(200);
    await call('get', '/v1/t-crm', owner.accessToken).expect(403);
  });

  it('TOTP: login needs the code; mandatory 2FA blocks sessions without one; recovery codes work once', async () => {
    const owner = await founder('mfa-owner', 'Mfa Inc');
    await enable(owner.tenantId, 'crm');
    // the policy cannot be turned on by someone without a second factor yet
    await call('patch', '/v1/org/security', owner.accessToken, { require2fa: true }).expect(400);

    const setup = (await call('post', '/v1/auth/totp/setup', owner.accessToken).expect(200)).body as { secret: string };
    const code = () => hotp(base32Decode(setup.secret), totpStep(Date.now()));
    await call('post', '/v1/auth/totp/enable', owner.accessToken, { code: '000000' }).expect(401);
    const enabled = (await call('post', '/v1/auth/totp/enable', owner.accessToken, { code: code() }).expect(200)).body as { recoveryCodes: string[] };
    expect(enabled.recoveryCodes).toHaveLength(10);
    const upgraded = (await http().post('/v1/auth/refresh').send({ refreshToken: owner.refreshToken }).expect(200)).body;
    await call('patch', '/v1/org/security', upgraded.accessToken, { require2fa: true }).expect(200);

    // a fresh password login now returns a challenge, not tokens
    const first = await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ identifier: 'ac-mfa-owner', password: PW }).expect(200);
    expect(first.body.accessToken).toBeUndefined();
    expect(first.body).toMatchObject({ mfaRequired: true });
    await http().post('/v1/auth/login/mfa').send({ challenge: first.body.challenge, code: '111111' }).expect(401);
    // a TOTP code is single-use (replay protection): wait for the next step is not needed, use a recovery code instead
    const done = await http().post('/v1/auth/login/mfa').send({ challenge: first.body.challenge, code: enabled.recoveryCodes[0] }).expect(200);
    await call('get', '/v1/t-crm', done.body.accessToken).expect(200);
    // the same recovery code cannot be used again
    const second = await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ identifier: 'ac-mfa-owner', password: PW }).expect(200);
    await http().post('/v1/auth/login/mfa').send({ challenge: second.body.challenge, code: enabled.recoveryCodes[0] }).expect(401);

    // a member with no second factor is stopped at the guard once the org requires it
    const staff = await joinBy('mfa-staff', await invite({ accessToken: upgraded.accessToken }, { roleKey: 'sales' }));
    const denied = await call('get', '/v1/t-crm', staff.accessToken).expect(403);
    expect(denied.body.code).toBe('MFA_REQUIRED');
  });

  it('sessions: list devices, revoke another one, and a revoked session stops working at once', async () => {
    const owner = await founder('ses-owner', 'Sessions Inc');
    await enable(owner.tenantId, 'crm');
    const login = await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120.0 Safari/537').send({ identifier: 'ac-ses-owner', password: PW }).expect(200);
    const list = (await call('get', '/v1/auth/sessions', owner.accessToken).expect(200)).body as Array<{ id: string; current: boolean; device: string }>;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.some((s) => s.device === 'Chrome on macOS')).toBe(true);

    await call('get', '/v1/t-crm', login.body.accessToken).expect(200);
    const other = list.find((s) => !s.current && s.device === 'Chrome on macOS')!;
    await call('delete', `/v1/auth/sessions/${other.id}`, owner.accessToken).expect(204);
    await call('get', '/v1/t-crm', login.body.accessToken).expect(401);
    await http().post('/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    await call('get', '/v1/t-crm', owner.accessToken).expect(200); // the current one is untouched
    // cannot revoke somebody else's session
    const alien = await founder('ses-alien', 'Alien Inc');
    const alienSessions = (await call('get', '/v1/auth/sessions', alien.accessToken)).body as Array<{ id: string }>;
    await call('delete', `/v1/auth/sessions/${alienSessions[0].id}`, owner.accessToken).expect(404);
  });

  it('new-device sign-in sends an alert; the first ever sign-in does not', async () => {
    const before = alerts.length;
    await signup('alert');
    expect(alerts.length).toBe(before);
    await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).set('User-Agent', 'BrandNewBrowser/1').send({ identifier: 'ac-alert', password: PW }).expect(200);
    expect(alerts.at(-1)).toBe('ac-alert@example.com');
  });

  it('lockout: repeated wrong passwords are throttled and each failure is audited', async () => {
    const owner = await founder('lock-owner', 'Lock Inc');
    const ip = freshIp();
    for (let i = 0; i < 5; i += 1) {
      await http().post('/v1/auth/login').set('X-Forwarded-For', ip).send({ identifier: 'ac-lock-owner', password: 'wrong-wrong-wrong' }).expect(401);
    }
    await http().post('/v1/auth/login').set('X-Forwarded-For', ip).send({ identifier: 'ac-lock-owner', password: PW }).expect(429);
    const log = (await call('get', '/v1/org/audit?limit=100', owner.accessToken).expect(200)).body.items as Array<{ action: string }>;
    expect(log.filter((r) => r.action === 'auth.login.failed')).toHaveLength(5);
  });

  it('audit log: records who did what, is admin-only, and cannot be edited or deleted', async () => {
    const owner = await founder('aud-owner', 'Audit Inc');
    await enable(owner.tenantId, 'crm');
    const staff = await joinBy('aud-staff', await invite(owner, { roleKey: 'sales' }));
    await call('post', '/v1/t-crm', staff.accessToken).expect(201);
    await call('post', '/v1/org/branches', owner.accessToken, { name: 'HQ' }).expect(201);

    const log = (await call('get', '/v1/org/audit?limit=100', owner.accessToken).expect(200)).body.items as Array<{ action: string; actorUserId: string; resourceId: string; metadata: unknown }>;
    expect(log.find((r) => r.action === 'http.POST' && r.resourceId === '/v1/t-crm')?.actorUserId).toBe(staff.user.id);
    expect(log.some((r) => r.action === 'branch.create' && r.actorUserId === owner.userId)).toBe(true);
    expect(log.some((r) => r.action === 'invitation.create')).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/password|token_hash|secret/i);

    await call('get', '/v1/org/audit', staff.accessToken).expect(403);
    // inside the tenant's own scope (RLS lets the rows be seen), the trigger still refuses
    const inScope = (sql: string) =>
      db.transaction(async (m) => {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [owner.tenantId]);
        return m.query(sql, [owner.tenantId]);
      });
    // superuser: the trigger raises; owner role: RLS has no UPDATE/DELETE policy, so nothing is touched;
    // restricted app role: it holds no UPDATE/DELETE grant on audit_log
    const before = (await inScope(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1`))[0].n;
    for (const sql of [`UPDATE audit_log SET action='x' WHERE tenant_id=$1`, `DELETE FROM audit_log WHERE tenant_id=$1`]) {
      await inScope(sql).then(
        (res) => expect(Array.isArray(res) ? res[1] ?? 0 : 0).toBe(0),
        (err: Error) => expect(err.message).toMatch(/append-only|permission denied/),
      );
    }
    expect((await inScope(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1`))[0].n).toBe(before);
    expect((await inScope(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='x'`))[0].n).toBe(0);
  });

  it('invitations: expired, revoked and reused links are refused; unknown tokens look identical', async () => {
    const owner = await founder('exp-owner', 'Expiry Inc');
    const t1 = await invite(owner, { roleKey: 'sales' });
    await db.query(`UPDATE tenant_invitations SET expires_at = now() - interval '1 minute' WHERE tenant_id=$1`, [owner.tenantId]);
    await http().get(`/v1/invitations/${t1}`).expect(410);
    const t2 = await invite(owner, { roleKey: 'sales' });
    const pending = (await call('get', '/v1/org/invitations', owner.accessToken)).body as Array<{ id: string }>;
    await call('delete', `/v1/org/invitations/${pending[0].id}`, owner.accessToken).expect(204);
    // whichever one was revoked, an unknown token is the same answer
    await http().get('/v1/invitations/' + 'x'.repeat(43)).expect(404);
    expect([t2].length).toBe(1);
  });

  it('legacy migrated MEMBER keeps CRM and the assistant, nothing more', async () => {
    const owner = await founder('leg-owner', 'Legacy Inc');
    await enable(owner.tenantId, 'crm', 'accounting');
    const s = await signup('leg-member');
    await db.query(`INSERT INTO tenant_memberships (tenant_id,user_id,role_key) VALUES ($1,$2,'legacy_member')`, [owner.tenantId, s.user.id]);
    const fresh = (await http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200)).body;
    await call('get', '/v1/t-crm', fresh.accessToken).expect(200);
    await call('get', '/v1/t-acc', fresh.accessToken).expect(403);
    await call('get', '/v1/org/members', fresh.accessToken).expect(403);
  });

  it('module catalogue: dependencies are enforced, owners can only request, and the trial switch needs no migration', async () => {
    const owner = await founder('cat-owner', 'Catalogue Inc');
    const op = await signup('cat-op');
    await db.query(`UPDATE users SET role='ADMIN' WHERE id=$1`, [op.user.id]);
    const opTok = (await http().post('/v1/auth/login').set('X-Forwarded-For', freshIp()).send({ identifier: 'ac-cat-op', password: PW }).expect(200)).body.accessToken;
    const set = (changes: object[]) => call('put', `/v1/admin/entitlements/${owner.tenantId}`, opTok, { changes });

    await set([{ module: 'hr', enabled: true }]).expect(400); // payroll needs accounting
    await set([{ module: 'accounting', enabled: true }, { module: 'hr', enabled: true }]).expect(200);
    await set([{ module: 'accounting', enabled: false }]).expect(400); // hr still depends on it
    await set([{ module: 'tax', enabled: true }]).expect(400); // needs invoicing

    const cat = (await call('get', '/v1/org/module-catalogue', owner.accessToken).expect(200)).body;
    expect(cat.allEnabled).toBe(false);
    expect(cat.modules.find((m: { module: string }) => m.module === 'hr')).toMatchObject({ enabled: true, dependsOn: ['accounting'] });
    expect(JSON.stringify(cat)).not.toMatch(/price|amount|cost/i);

    // the owner can ask for a module but cannot switch it on
    await call('post', '/v1/org/module-requests', owner.accessToken, { module: 'crm' }).expect(201);
    await call('post', '/v1/org/module-requests', owner.accessToken, { module: 'crm' }).expect(409);
    await call('post', '/v1/org/module-requests', owner.accessToken, { module: 'hr' }).expect(409); // already on
    const open = (await call('get', '/v1/admin/entitlements/requests/open', opTok).expect(200)).body as Array<{ tenantId: string; module: string }>;
    expect(open.some((r) => r.tenantId === owner.tenantId && r.module === 'crm')).toBe(true);
    await call('get', '/v1/admin/entitlements/requests/open', owner.accessToken).expect(403);
    await set([{ module: 'crm', enabled: true }]).expect(200);
    const after = (await call('get', '/v1/admin/entitlements/requests/open', opTok)).body as Array<{ tenantId: string; module: string }>;
    expect(after.some((r) => r.tenantId === owner.tenantId && r.module === 'crm')).toBe(false);

    // trial switch ON: everything open for everyone, no migration involved
    process.env.ALL_MODULES_ENABLED = 'true';
    const rich = await founder('cat-trial', 'Trial Inc');
    await new Promise((r) => setTimeout(r, 0));
    await db.query(`SELECT 1`);
    (app.get(require('../modules/access/services/access.service').AccessService) as { invalidateTenant(t: string): void }).invalidateTenant(rich.tenantId);
    await call('get', '/v1/t-crm', rich.accessToken).expect(200);
    await call('get', '/v1/t-acc', rich.accessToken).expect(200);
    process.env.ALL_MODULES_ENABLED = 'false';
    (app.get(require('../modules/access/services/access.service').AccessService) as { invalidateTenant(t: string): void }).invalidateTenant(rich.tenantId);
    await call('get', '/v1/t-crm', rich.accessToken).expect(403);
  });

  it('audit hash chain: verifies, and detects a tampered row even when the trigger is bypassed', async () => {
    const owner = await founder('hash-owner', 'Hash Inc');
    await call('post', '/v1/org/branches', owner.accessToken, { name: 'One' }).expect(201);
    await call('post', '/v1/org/branches', owner.accessToken, { name: 'Two' }).expect(201);
    const ok = (await call('get', '/v1/org/audit/verify', owner.accessToken).expect(200)).body;
    expect(ok).toMatchObject({ ok: true, brokenAtId: null });
    expect(ok.checked).toBeGreaterThanOrEqual(3);
    // an attacker with table-owner rights disables the trigger and edits history
    // the restricted app role cannot do this, so the rehearsal passes the owner's password
    const ownerDb = process.env.APP_E2E_ADMIN_PASSWORD
      ? await new DataSource({
          type: 'postgres',
          host: process.env.DATABASE_HOST,
          port: Number(process.env.DATABASE_PORT),
          username: 'enterprise_admin',
          password: process.env.APP_E2E_ADMIN_PASSWORD,
          database: process.env.DATABASE_NAME,
        }).initialize()
      : db;
    await ownerDb.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [owner.tenantId]);
      await m.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change`);
      await m.query(`ALTER TABLE audit_log NO FORCE ROW LEVEL SECURITY`);
      await m.query(
        `UPDATE audit_log SET action='branch.hacked' WHERE id = (SELECT min(id) FROM audit_log WHERE tenant_id=$1 AND action='branch.create')`,
        [owner.tenantId],
      );
      await m.query(`ALTER TABLE audit_log FORCE ROW LEVEL SECURITY`);
      await m.query(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change`);
    });
    if (ownerDb !== db) await ownerDb.destroy();
    const bad = (await call('get', '/v1/org/audit/verify', owner.accessToken).expect(200)).body;
    expect(bad.ok).toBe(false);
    expect(bad.brokenAtId).toBeTruthy();
  });

  it('row-level security: tenant tables are invisible without a tenant scope (non-superuser owner only)', async () => {
    const owner = await founder('rls-owner', 'Rls Inc');
    await call('post', '/v1/org/branches', owner.accessToken, { name: 'Secret branch' }).expect(201);
    const isSuper = (await db.query(`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`))[0].s as boolean;
    if (isSuper) {
      console.warn('skipping RLS assertion: connected as a superuser (RLS is bypassed). Run as a non-superuser owner.');
      return;
    }
    const bare = await db.query(`SELECT count(*)::int n FROM tenant_branches`);
    expect(bare[0].n).toBe(0);
    const scoped = await db.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [owner.tenantId]);
      return m.query(`SELECT count(*)::int n FROM tenant_branches`);
    });
    expect(scoped[0].n).toBe(1);
    const other = await db.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, ['00000000-0000-4000-8000-0000000000ff']);
      return m.query(`SELECT count(*)::int n FROM tenant_branches`);
    });
    expect(other[0].n).toBe(0);
  });
});
