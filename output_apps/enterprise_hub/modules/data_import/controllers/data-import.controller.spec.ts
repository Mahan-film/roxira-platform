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
import { accessTestProviders } from '../../../test/support/access-stub';
import { DataImportService } from '../services/data-import.service';
import { EntityImportService } from '../services/entity-import.service';
import { PackageImportService } from '../services/package-import.service';
import { ChunkedUploadService } from '../services/chunked-upload.service';
import { SepidarPersistenceService } from '../services/sepidar-persistence.service';
import { DataImportController } from './data-import.controller';

const SECRET = 'data-import-test-secret-1234567890';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

const { stub, providers: accessProviders } = accessTestProviders();

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
        {
          provide: EntityImportService,
          useValue: {
            listEntities: jest.fn().mockReturnValue([]),
            listBatches: jest.fn().mockResolvedValue([]),
            preview: jest.fn().mockResolvedValue({}),
            commit: jest.fn().mockResolvedValue({
              batchId: 'b',
              inserted: 0,
              skippedDuplicates: 0,
              failed: [],
            }),
            undoBatch: jest
              .fn()
              .mockResolvedValue({ removed: 0, refused: [] }),
          },
        },
        JwtAuthGuard,
        { provide: ChunkedUploadService, useValue: {} },
        {
          provide: SepidarPersistenceService,
          useValue: {
            persistSepidarData: jest.fn().mockResolvedValue({
              tenantId: 'tenant-1',
              certifiedAt: '2026-11-12T00:00:00.000Z',
              balanced: true,
              varianceMinor: '0',
              counts: { accounts: 0, parties: 0, items: 0, openingLines: 0, cheques: 0 },
              totals: { openingDebitMinor: '0', openingCreditMinor: '0', chequesAmountMinor: '0' },
              canonicalSha256: '0'.repeat(64),
              idempotencySummary: {
                accountsInserted: 0,
                accountsSkipped: 0,
                partiesInserted: 0,
                partiesSkipped: 0,
                itemsInserted: 0,
                itemsSkipped: 0,
                openingVoucherCreated: false,
                chequesInserted: 0,
                chequesSkipped: 0,
              },
            }),
          },
        },
        {
          provide: PackageImportService,
          useValue: {
            createPackage: jest
              .fn()
              .mockResolvedValue({ packageId: 'p', status: 'analyzing' }),
            getPackage: jest.fn().mockResolvedValue({
              packageId: 'p',
              status: 'analyzing',
              tables: [],
              relationships: [],
              health: { checks: [] },
              currencies: [],
            }),
            commitPackage: jest.fn().mockResolvedValue({ batchId: 'b' }),
            getProgress: jest.fn().mockResolvedValue({
              phase: 'ready',
              done: 0,
              total: 0,
              inserted: {},
              skipped: {},
              errors: [],
            }),
          },
        },
        ...accessProviders,
        ...GLOBAL_GUARD_PROVIDERS,
      ],
    }).compile();
    stub.grant('owner', 'tenant-1', 'owner');
    stub.grant('admin', 'tenant-1', 'owner');
    stub.grant('member', 'tenant-1', 'legacy_member');

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

  /** sub follows the role so the stub membership (owner / legacy member / none) matches the old claims. */
  const token = (payload: Record<string, unknown>) =>
    jwt.sign({
      sub:
        payload.tenantRole === TenantRole.OWNER
          ? 'owner'
          : payload.tenantRole === TenantRole.MEMBER
            ? 'member'
            : payload.role === UserRole.ADMIN
              ? 'admin'
              : 'nobody',
      phone: '09120000000',
      domain: 'ROXIRA',
      ...payload,
    });

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

  describe('POST /enterprise-hub/data-import/sepidar/persist', () => {
    const sepidarUrl = '/enterprise-hub/data-import/sepidar/persist';
    const validSepidarBody = {
      accounts: [{ AccountID: 1, Code: '1', Title: 'دارایی', Level: 1, ParentAccountID: null }],
    };

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer()).post(sepidarUrl).send(validSepidarBody).expect(401);
    });

    it('rejects a tenant MEMBER (read-only / no create permission) with 403', async () => {
      await request(app.getHttpServer())
        .post(sepidarUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.MEMBER,
          })}`,
        )
        .send(validSepidarBody)
        .expect(403);
    });

    it('rejects malformed nested account elements with 400', async () => {
      await request(app.getHttpServer())
        .post(sepidarUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.OWNER,
          })}`,
        )
        .send({ accounts: [{ Code: 123, Level: 99 }] })
        .expect(400);
    });

    it('allows tenant OWNER with valid payload (200)', async () => {
      await request(app.getHttpServer())
        .post(sepidarUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.OWNER,
          })}`,
        )
        .send(validSepidarBody)
        .expect(200);
    });
  });
});
