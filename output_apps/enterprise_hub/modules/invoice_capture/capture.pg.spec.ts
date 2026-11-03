import { TenantScope } from '../access/services/tenant-scope';
/**
 * Invoice capture against a REAL PostgreSQL. The model is faked; the migration, repository and ledger are real.
 * Opt-in: ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55439 npx jest modules/invoice_capture/capture.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../accounting/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../accounting/entities/journal-entry-line.entity';
import { PeriodLockEntity } from '../accounting/entities/period-lock.entity';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';
import {
  CaptureAuditEntity, CaptureDocumentEntity, CaptureFileEntity, CaptureSettingsEntity, CaptureVendorEntity, CaptureVendorRuleEntity,
} from './entities/capture.entities';
import { CaptureRepository } from './repositories/capture.repository';
import { CaptureService } from './services/capture.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432,
  username: process.env.ROXIRA_TEST_PG_USER ?? 'postgres',
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts'), path.join(__dirname, 'entities/capture.entities.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
});

const admin = async (sql: string) => {
  const ds = new DataSource({ ...options('postgres'), entities: [], migrations: [] });
  await ds.initialize();
  await ds.query(sql);
  await ds.destroy();
};

const invoice = JSON.stringify({
  kind: 'purchase',
  seller: { name: 'شرکت پخش البرز', tax_id: '10320894217' },
  buyer: { name: 'ما', tax_id: '' },
  invoice_number: '1234', date: '1405/08/10', currency: 'ریال',
  items: [{ description: 'کاغذ', quantity: 2, unit_price: 1500000, total: 3000000 }],
  subtotal: 3000000, tax: 300000, total: 3300000, paid: false,
  confidence: { seller: 0.99, buyer: 0.99, tax_id: 0.99, invoice_number: 0.99, date: 0.99, items: 0.99, tax: 0.99, total: 0.99 },
});

describePg('Invoice capture on PostgreSQL', () => {
  const dbName = `rx_capture_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let service: CaptureService;
  let accounting: AccountingService;

  beforeAll(async () => {
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    accounting = new AccountingService(
      new AccountingRepository(new TenantScope(ds)),
      { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService,
    );
    const llm = {
      extract: async (_input: unknown, accept: (content: string) => void) => {
        accept(invoice);
        return { model: 'test/model:free', content: invoice, tokensIn: 10, tokensOut: 5, costUsd: 0, attempts: [{ model: 'test/model:free', ok: true }] };
      },
    };
    service = new CaptureService(
      new CaptureRepository(
        ds.getRepository(CaptureDocumentEntity),
        ds.getRepository(CaptureFileEntity),
        ds.getRepository(CaptureVendorEntity),
        ds.getRepository(CaptureVendorRuleEntity),
        ds.getRepository(CaptureSettingsEntity),
        ds.getRepository(CaptureAuditEntity),
      ),
      llm as never,
      accounting,
    );
  }, 180_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('a draft posts a balanced voucher only on request, and only once', async () => {
    await accounting.listAccounts(T1);
    const view = await service.create(T1, 'u1', undefined, { text: 'فاکتور ۱۲۳۴' });
    expect(view.status).toBe('draft');
    expect(await ds.query(`SELECT 1 FROM fin_journal_entries WHERE tenant_id = $1`, [T1])).toEqual([]);

    const posted = await service.post(T1, 'u1', view.id);
    expect(posted.status).toBe('posted');
    const lines = await ds.query(
      `SELECT l.debit, l.credit FROM fin_journal_entry_lines l JOIN fin_journal_entries e ON e.id = l.journal_entry_id WHERE e.tenant_id = $1`,
      [T1],
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.reduce((sum: number, l: { debit: string; credit: string }) => sum + Number(l.debit) - Number(l.credit), 0)).toBe(0);
    await service.post(T1, 'u1', view.id);
    const [{ n }] = await ds.query(`SELECT count(*) AS n FROM fin_journal_entries WHERE tenant_id = $1`, [T1]);
    expect(n).toBe('1');
  });

  it('reversal keeps the original, and another tenant reaches nothing', async () => {
    const [doc] = await service.recent(T1);
    await expect(service.post(T2, 'evil', doc.id)).rejects.toThrow();
    const reversed = await service.reverse(T1, 'u1', doc.id, 'اشتباه');
    expect(reversed.status).toBe('reversed');
    const [{ n }] = await ds.query(`SELECT count(*) AS n FROM fin_journal_entries WHERE tenant_id = $1`, [T1]);
    expect(n).toBe('2');
    expect(await service.recent(T2)).toEqual([]);
  });

  it('the audit trail is append-only', async () => {
    await expect(ds.query(`UPDATE capture_audit SET actor = 'x'`)).rejects.toThrow();
  });
});
