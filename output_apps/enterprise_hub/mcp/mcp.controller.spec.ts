import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  GLOBAL_GUARD_PROVIDERS,
  globalThrottlerModule,
} from '../security/global-guards';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { UserRole } from '../modules/auth/enums/user-role.enum';
import { McpController } from './mcp.controller';
import { McpHttpHandler } from './mcp-http.handler';

const SECRET = 'fake-secret-for-mcp-spec-x';

/**
 * آزمون سبک e2e برای احراز هویت و جداسازی مستأجر روی نقطه پایانی MCP.
 *
 * بررسی می‌کند که: درخواست بدون توکن ۴۰۱ می‌گیرد، توکن بدون claim مستأجر ۴۰۳
 * می‌گیرد و توکن معتبر به هندلر MCP با همان مستأجر می‌رسد. هندلر واقعی SDK
 * mock می‌شود تا آزمون به اجرای واقعی پروتکل وابسته نباشد.
 */
describe('McpController (auth + tenant isolation)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const handler = {
    handle: jest.fn((_req: unknown, res: any) => {
      res.status(200).json({ jsonrpc: '2.0', id: 1, result: {} });
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [globalThrottlerModule, JwtModule.register({ secret: SECRET })],
      controllers: [McpController],
      providers: [
        { provide: McpHttpHandler, useValue: handler },
        JwtAuthGuard,
        ...GLOBAL_GUARD_PROVIDERS,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const token = (payload: Record<string, unknown>) =>
    jwt.sign({ sub: 'u1', phone: '09120000000', domain: 'ROXIRA', ...payload });

  const url = '/enterprise-hub/mcp';
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

  beforeEach(() => handler.handle.mockClear());

  it('rejects unauthenticated calls with 401', async () => {
    await request(app.getHttpServer()).post(url).send(body).expect(401);
  });

  it('rejects a token without a tenant claim with 403', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token({ role: UserRole.USER })}`)
      .send(body)
      .expect(403);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('routes an authenticated tenant user to the MCP handler', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set(
        'Authorization',
        `Bearer ${token({ role: UserRole.USER, tenantId: 'tenant-1' })}`,
      )
      .send(body)
      .expect(200);

    expect(handler.handle).toHaveBeenCalledTimes(1);
    const [reqArg] = handler.handle.mock.calls[0];
    expect((reqArg as { user: { tenantId: string } }).user.tenantId).toBe(
      'tenant-1',
    );
  });

  it('answers GET with 405 (stateless transport)', async () => {
    await request(app.getHttpServer())
      .get(url)
      .set(
        'Authorization',
        `Bearer ${token({ role: UserRole.USER, tenantId: 'tenant-1' })}`,
      )
      .expect(405);
  });

  it('answers DELETE with 405 (stateless transport)', async () => {
    await request(app.getHttpServer())
      .delete(url)
      .set(
        'Authorization',
        `Bearer ${token({ role: UserRole.USER, tenantId: 'tenant-1' })}`,
      )
      .expect(405);
  });
});
