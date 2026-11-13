/**
 * Quotation to Sales Invoice conversion on a REAL PostgreSQL as a non-superuser role (T104):
 * - Runs migration 1789900004500 with FORCE RLS
 * - Connects as non-superuser NOSUPERUSER NOBYPASSRLS role
 * - Enforces tenant isolation (Tenant A cannot see Tenant B's quotations)
 * - Tests 1-click conversion into sales invoice as roxira_app
 * - Tests idempotency (409 Conflict on duplicate conversion)
 * - Tests expiry date rejection (400 BadRequest when validUntil < invoiceDate)
 * - Tests raw RLS without app.tenant_id returning 0 rows
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { PartiesRepository } from '../../parties/repositories/parties.repository';
import { PartiesService } from '../../parties/services/parties.service';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { VatRateResolver } from '../../invoicing/services/vat-rate.resolver';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { CurrencyService } from '../../currency/services/currency.service';
import { SalesQuotationEntity, SalesQuotationLineEntity } from '../entities/sales-quotation.entity';
import { SalesQuotationStatus } from '../enums/sales-status.enum';
import { SalesRepository } from '../repositories/sales.repository';
import { SalesService } from '../services/sales.service';
import { QuotationToInvoiceService } from './services/quotation-to-invoice.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'quotation-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Quotation to Invoice conversion on PostgreSQL (non-superuser, FORCE RLS - T104)', () => {
  const db = `rx_qinv_${process.pid}_${Date.now()}`;
  const role = `rx_qinv_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;

  let salesRepo: SalesRepository;
  let salesService: SalesService;
  let partiesService: PartiesService;
  let invoicingService: InvoicingService;
  let invoicingRepo: InvoicingRepository;
  let quotationToInvoiceService: QuotationToInvoiceService;
  let itemId: number;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);

    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();
    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);

    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();

    const scope = new TenantScope(app);
    salesRepo = new SalesRepository(scope);
    partiesService = new PartiesService(new PartiesRepository(scope));
    salesService = new SalesService(salesRepo, partiesService);

    const currencyService = {
      convertAmount: jest.fn().mockImplementation(async (amount: number) => ({
        convertedAmount: amount,
        rate: 1,
        fxRate: 1,
      })),
    } as unknown as CurrencyService;

    invoicingRepo = new InvoicingRepository(app);
    invoicingService = new InvoicingService(invoicingRepo, currencyService);
    const statutoryRepo = new StatutoryRepository(app);
    const vatRateResolver = new VatRateResolver(statutoryRepo);
    const tenantsRepo = new TenantsRepository(app);

    quotationToInvoiceService = new QuotationToInvoiceService(
      salesRepo,
      invoicingService,
      invoicingRepo,
      partiesService,
      tenantsRepo,
      vatRateResolver,
    );

    // Seed customer in T1
    await partiesService.create(T1, {
      code: 'CUST-T1',
      name: 'مشتری آزمایشی ۱',
      role: PartyRole.CUSTOMER,
      nationalId: '10100000001',
      economicCode: '4111111111',
    });

    // Seed customer in T2
    await partiesService.create(T2, {
      code: 'CUST-T2',
      name: 'مشتری آزمایشی ۲',
      role: PartyRole.CUSTOMER,
      nationalId: '10200000002',
    });

    // Seed stock item for T1
    const itemRows = await owner.query(
      `INSERT INTO erp_stock_items (tenant_id, sku, name, primary_unit)
       VALUES ($1, 'SKU-Q1', 'کالای پیش‌فاکتور', 'عدد') RETURNING id`,
      [T1],
    );
    itemId = itemRows[0].id;
  });

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.destroy();
    }
  });

  it('verifies non-superuser role and FORCE RLS on erp_sales_quotations table', async () => {
    const roleCheck = await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [role],
    );
    expect(roleCheck[0].rolsuper).toBe(false);
    expect(roleCheck[0].rolbypassrls).toBe(false);

    const rlsCheck = await app.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'erp_sales_quotations'`,
    );
    expect(rlsCheck[0].relrowsecurity).toBe(true);
    expect(rlsCheck[0].relforcerowsecurity).toBe(true);
  });

  it('enforces tenant isolation under RLS: Tenant 2 cannot see Tenant 1 quotations', async () => {
    const q1 = await salesService.createQuotation(T1, {
      partyCode: 'CUST-T1',
      quoteDate: '2026-11-10',
      validUntil: '2026-12-10',
      lines: [
        {
          lineNo: 1,
          itemId,
          quantity: 3,
          unitPrice: '100000.00',
          description: 'تست ایزولاسیون',
        },
      ],
    });

    // T1 can read its quotation
    const foundT1 = await salesService.getQuotation(T1, q1.id);
    expect(foundT1.number).toBe(q1.number);

    // T2 cannot see T1 quotation
    await expect(salesService.getQuotation(T2, q1.id)).rejects.toThrow(NotFoundException);
  });

  it('performs 1-click conversion to sales invoice as roxira_app and verifies idempotency', async () => {
    const quotation = await salesService.createQuotation(T1, {
      partyCode: 'CUST-T1',
      quoteDate: '2026-11-12',
      validUntil: '2026-12-12',
      lines: [
        {
          lineNo: 1,
          itemId,
          quantity: 5,
          unitPrice: '200000.00',
          description: 'خط صورتحساب ۱',
        },
      ],
    });

    const result = await quotationToInvoiceService.convertQuotationToInvoice(T1, quotation.id, {
      invoiceDate: '2026-11-13',
    });

    expect(result.quotationId).toBe(quotation.id);
    expect(result.invoiceId).toBeDefined();
    expect(result.taxInvoiceNumber).toBeDefined();
    expect(result.partyCode).toBe('CUST-T1');
    expect(result.replayed).toBe(false);

    // Verify quotation state in DB
    const updatedQuotation = await salesService.getQuotation(T1, quotation.id);
    expect(updatedQuotation.status).toBe(SalesQuotationStatus.CONVERTED);
    expect(updatedQuotation.convertedInvoiceId).toBe(result.invoiceId);

    // Verify invoice in DB
    const invoice = await invoicingService.findOne(T1, result.invoiceId);
    expect(invoice).toBeDefined();
    expect(invoice.buyerInfo.partyCode).toBe('CUST-T1');
    expect(invoice.items).toHaveLength(1);

    // 2nd conversion attempt throws 409 Conflict
    await expect(
      quotationToInvoiceService.convertQuotationToInvoice(T1, quotation.id),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects conversion and transitions status to EXPIRED when validUntil date has passed', async () => {
    const expiredQuotation = await salesService.createQuotation(T1, {
      partyCode: 'CUST-T1',
      quoteDate: '2026-10-01',
      validUntil: '2026-10-31', // in past relative to 2026-11-13
      lines: [
        {
          lineNo: 1,
          itemId,
          quantity: 1,
          unitPrice: '50000.00',
        },
      ],
    });

    await expect(
      quotationToInvoiceService.convertQuotationToInvoice(T1, expiredQuotation.id, {
        invoiceDate: '2026-11-13',
      }),
    ).rejects.toThrow(BadRequestException);

    const checked = await salesService.getQuotation(T1, expiredQuotation.id);
    expect(checked.status).toBe(SalesQuotationStatus.EXPIRED);
  });

  it('raw RLS query without app.tenant_id returns 0 rows', async () => {
    const rows = await app.query(`SELECT count(*)::int AS count FROM erp_sales_quotations`);
    expect(rows[0].count).toBe(0);
  });
});
