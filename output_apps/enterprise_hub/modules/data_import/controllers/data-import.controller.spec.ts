import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  GLOBAL_GUARD_PROVIDERS,
  globalThrottlerModule,
} from '../../../security/global-guards';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { TenantRole } from '../../tenants/enums/tenant-role.enum';
import { DataImportService } from '../services/data-import.service';
import { DataImportController } from './data-import.controller';

const SECRET = 'data-import-test-secret-1234567890';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('DataImportController (access control)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [globalThrottlerModule, JwtModule.register({ secret: SECRET })],
      controllers: [DataImportController],
      providers: [
        {
          provide: DataImportService,
          useValue: {
            preview: jest.fn().mockResolvedValue({}),
            commit: jest
              .fn()
              .mockResolvedValue({ imported: 0, skipped: 0, errors: [] }),
          },
        },
        JwtAuthGuard,
        ...GLOBAL_GUARD_PROVIDERS,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const token = (payload: Record<string, unknown>) =>
    jwt.sign({ sub: 'u1', phone: '09120000000', domain: 'ROXIRA', ...payload });

  const body = { uploadId: VALID_UUID, mapping: { name: 'fullName' } };
  const url = '/enterprise-hub/data-import/crm-leads/commit';

  it('rejects unauthenticated calls with 401', async () => {
    await request(app.getHttpServer()).post(url).send(body).expect(401);
  });

  it('rejects a plain USER with no tenant role with 403', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set(
        'Authorization',
        `Bearer ${token({ role: UserRole.USER, tenantId: 'tenant-1' })}`,
      )
      .send(body)
      .expect(403);
  });

  it('rejects a tenant MEMBER with 403', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set(
        'Authorization',
        `Bearer ${token({
          role: UserRole.USER,
          tenantId: 'tenant-1',
          tenantRole: TenantRole.MEMBER,
        })}`,
      )
      .send(body)
      .expect(403);
  });

  it('allows the tenant OWNER with 200', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set(
        'Authorization',
        `Bearer ${token({
          role: UserRole.USER,
          tenantId: 'tenant-1',
          tenantRole: TenantRole.OWNER,
        })}`,
      )
      .send(body)
      .expect(200);
  });

  it('allows the platform ADMIN with 200', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set(
        'Authorization',
        `Bearer ${token({ role: UserRole.ADMIN, tenantId: 'tenant-1' })}`,
      )
      .send(body)
      .expect(200);
  });

  it('rejects an invalid mapping value with 400', async () => {
    await request(app.getHttpServer())
      .post(url)
      .set(
        'Authorization',
        `Bearer ${token({
          role: UserRole.USER,
          tenantId: 'tenant-1',
          tenantRole: TenantRole.OWNER,
        })}`,
      )
      .send({ uploadId: VALID_UUID, mapping: { name: 'notAField' } })
      .expect(400);
  });
});
