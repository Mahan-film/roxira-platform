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
import { CutoverWizardService } from '../services/cutover-wizard.service';
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
        {
          provide: CutoverWizardService,
          useValue: {
            evaluatePreflight: jest.fn().mockResolvedValue({
              allGreen: true,
              canGoLive: true,
              items: [],
              discrepancies: [],
              blockersFa: [],
            }),
            executeGoLive: jest.fn().mockResolvedValue({
              status: 'completed',
              isGoLiveActive: true,
              cutoverDate: '2026-03-21',
              preCutoverLockDate: '2026-03-20',
              periodLockId: 77,
              legacyNumberPrefix: 'LEGACY-',
              tieOutSummary: { passed: true, totalChecks: 1, passedChecks: 1, discrepanciesCount: 0, items: [], discrepancies: [], blockersFa: [] },
            }),
            verifyPeriodLockPostingAttempt: jest.fn().mockResolvedValue({
              verified: true,
              errorType: 'PeriodLockedException',
              message: 'مسدود شد',
            }),
            getCutoverStatus: jest.fn().mockResolvedValue({
              isGoLiveActive: true,
              cutoverDate: '2026-03-21',
              preCutoverLockDate: '2026-03-20',
              periodLockId: 77,
              legacyNumberPrefix: 'LEGACY-',
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
    stub.grant('accountant', 'tenant-1', 'accountant');
    stub.grant('sales', 'tenant-1', 'sales');

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
      accounts: [{ AccountID: 1, Code: '1010', Title: 'موجودی نقد', Level: 1, ParentAccountID: null }],
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

    it('allows tenant ACCOUNTANT (200) and rejects SALES (403)', async () => {
      await request(app.getHttpServer())
        .post(sepidarUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            sub: 'accountant',
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.MEMBER,
          })}`,
        )
        .send(validSepidarBody)
        .expect(200);

      await request(app.getHttpServer())
        .post(sepidarUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            sub: 'sales',
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.MEMBER,
          })}`,
        )
        .send(validSepidarBody)
        .expect(403);
    });

    it('rejects cheque payload with number Amount (must be integer Rial string) with 400', async () => {
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
        .send({
          cheques: [
            {
              ChequeId: 1,
              ChequeNumber: 'CHQ-1',
              SayadNumber: '1234567890123456',
              Direction: 'received',
              State: 'in_hand',
              Amount: 150000000,
              IssueDate: '2026-10-01',
              DueDate: '2026-11-01',
              PartyCode: 'P-1',
              PartyName: 'طرف حساب',
              BankName: 'بانک ملت',
            },
          ],
        })
        .expect(400);
    });
  });

  describe('Cutover Wizard Endpoints (R32 D4/D5)', () => {
    const preflightUrl = '/enterprise-hub/data-import/cutover/preflight';
    const goLiveUrl = '/enterprise-hub/data-import/cutover/go-live';
    const verifyLockUrl = '/enterprise-hub/data-import/cutover/verify-lock';
    const statusUrl = '/enterprise-hub/data-import/cutover/status';

    it('POST /cutover/preflight rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post(preflightUrl)
        .send({ cutoverDate: '2026-03-21' })
        .expect(401);
    });

    it('POST /cutover/preflight allows tenant OWNER and validates date format', async () => {
      await request(app.getHttpServer())
        .post(preflightUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.OWNER,
          })}`,
        )
        .send({ cutoverDate: 'invalid-date' })
        .expect(400);

      await request(app.getHttpServer())
        .post(preflightUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.OWNER,
          })}`,
        )
        .send({ cutoverDate: '2026-03-21' })
        .expect(200);
    });

    it('POST /cutover/go-live allows tenant OWNER with valid payload (200)', async () => {
      await request(app.getHttpServer())
        .post(goLiveUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.OWNER,
          })}`,
        )
        .send({
          cutoverDate: '2026-03-21',
          legacyNumberPrefix: 'LEGACY-',
        })
        .expect(200);
    });

    it('POST /cutover/verify-lock allows tenant OWNER (200)', async () => {
      await request(app.getHttpServer())
        .post(verifyLockUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.OWNER,
          })}`,
        )
        .send({ attemptDate: '2026-03-20' })
        .expect(200);
    });

    it('GET /cutover/status allows tenant OWNER (200)', async () => {
      await request(app.getHttpServer())
        .get(statusUrl)
        .set(
          'Authorization',
          `Bearer ${token({
            role: UserRole.USER,
            tenantId: 'tenant-1',
            tenantRole: TenantRole.OWNER,
          })}`,
        )
        .expect(200);
    });
  });
});
