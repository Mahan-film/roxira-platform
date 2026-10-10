import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { AUTH_THROTTLE } from '../modules/auth/constants/auth.constants';
import { Public } from '../modules/auth/decorators/public.decorator';
import { Roles } from '../modules/auth/decorators/roles.decorator';
import { UserRole } from '../modules/auth/enums/user-role.enum';
import { GLOBAL_GUARD_PROVIDERS, globalThrottlerModule } from './global-guards';
import { isSwaggerEnabled } from './swagger.util';

const SECRET = 'test-secret-test-secret-test-secret-123';

/** کنترلر شبیه‌ساز ماژول‌های بدون @UseGuards (مثل hr/accounting قبل از اصلاح). */
@Controller('unguarded')
class UnguardedController {
  @Get()
  list(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller('open')
class OpenController {
  @Public()
  @Get()
  health(): { ok: boolean } {
    return { ok: true };
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('login')
  login(): { ok: boolean } {
    return { ok: true };
  }
}

@Roles(UserRole.ADMIN)
@Controller('admin-only')
class AdminController {
  @Get()
  run(): { ok: boolean } {
    return { ok: true };
  }
}

describe('Global guards (JWT + roles + throttler)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [globalThrottlerModule, JwtModule.register({ secret: SECRET })],
      controllers: [UnguardedController, OpenController, AdminController],
      providers: GLOBAL_GUARD_PROVIDERS,
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const token = (role: UserRole) =>
    jwt.sign({ sub: 'u1', phone: '09120000000', role, domain: 'ROXIRA' });

  it('returns 401 for an unguarded controller without a token', async () => {
    await request(app.getHttpServer()).get('/unguarded').expect(401);
  });

  it('returns 401 for a forged / wrong-secret token', async () => {
    const forged = new JwtService({ secret: 'another-secret' }).sign({ sub: 'x' });
    await request(app.getHttpServer())
      .get('/unguarded')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('returns 200 with a valid token', async () => {
    await request(app.getHttpServer())
      .get('/unguarded')
      .set('Authorization', `Bearer ${token(UserRole.USER)}`)
      .expect(200);
  });

  it('keeps @Public routes open without a token', async () => {
    await request(app.getHttpServer()).get('/open').expect(200);
  });

  it('rejects non-admin (403) and accepts admin on @Roles(ADMIN) routes', async () => {
    await request(app.getHttpServer()).get('/admin-only').expect(401);
    await request(app.getHttpServer())
      .get('/admin-only')
      .set('Authorization', `Bearer ${token(UserRole.USER)}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin-only')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
  });

  it('throttles an auth route after the strict limit (429)', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < AUTH_THROTTLE.limit; i += 1) {
      await request(server).post('/open/login').expect(201);
    }
    await request(server).post('/open/login').expect(429);
  });
});

describe('isSwaggerEnabled', () => {
  it('is disabled in production unless ENABLE_SWAGGER=1', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isSwaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: '1' })).toBe(true);
    expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
  });
});
