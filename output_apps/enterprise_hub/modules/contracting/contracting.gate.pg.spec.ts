/**
 * T3 gate (#227) on a REAL PostgreSQL: one contractor-side contract with an advance, three progress
 * statements, retention and a partial release, and one employer-side contract on the same project,
 * through the real services, the statutory store and the posting engine. Accounting is a fake that
 * rejects unbalanced entries and records every voucher line; the expected numbers below are
 * hand-computed (rial) and never taken from the code under test.
 *
 * Skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import { UnprocessableEntityException } from '@nestjs/common';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { AuditService } from '../access/services/audit.service';
import { TenantScope } from '../access/services/tenant-scope';
import { parseMinor } from '../accounting/money';
import { AccountingService } from '../accounting/services/accounting.service';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { StatutoryService } from '../hr/statutory/statutory.service';
import { PartiesRepository } from '../parties/repositories/parties.repository';
import { PartiesService } from '../parties/services/parties.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { ContractRepository } from './repositories/contract.repository';
import { MovementRepository } from './repositories/movement.repository';
import { ProjectRepository } from './repositories/project.repository';
import { StatementRepository } from './repositories/statement.repository';
import { ContractService } from './services/contract.service';
import { MovementService } from './services/movement.service';
import { ProfitabilityService } from './services/profitability.service';
import { ProjectService } from './services/project.service';
import { StatementService } from './services/statement.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const M = 1_000_000n; // one million rial, as minor units x100 below
const rial = (millions: number | bigint): bigint => BigInt(millions) * M * 100n;
const rialFrac = (tenthsOfMillion: bigint): bigint => tenthsOfMillion * (M / 10n) * 100n;

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432,
  username: process.env.ROXIRA_TEST_PG_USER ?? 'postgres',
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('T3 gate: contract, 3 statements, retention and release, advance and recovery', () => {
  const db = `rx_t3gate_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let projects: ProjectService;
  let contracts: ContractService;
  let statements: StatementService;
  let movements: MovementService;
  let profit: ProfitabilityService;
  let statutory: StatutoryService;
  const lines: Array<{ tenant: string; account: string; debit: bigint; credit: bigint }> = [];

  /** Net debit per account for a tenant, from the vouchers the fake ledger recorded. */
  const net = (tenant: string) => {
    const out: Record<string, bigint> = {};
    for (const l of lines.filter((x) => x.tenant === tenant)) out[l.account] = (out[l.account] ?? 0n) + l.debit - l.credit;
    return out;
  };

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    ds = await new DataSource(options(db)).initialize();
    await ds.runMigrations();
    for (const t of [T1, T2]) {
      await ds.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [t, t.slice(0, 8)]).catch(() => undefined);
    }
    const scope = new TenantScope(ds);
    const accounting = {
      listAccounts: async () => ['1201', '1250', '2250', '4101', '5250', '5201', '2101', '2260'].map((code) => ({ code, name: code })),
      createAccount: async () => undefined,
      findJournalEntryByNumber: async () => null,
      createJournalEntry: async (tenant: string, dto: { entryNumber: string; lines: Array<{ accountCode: string; debit: string; credit: string }> }) => {
        const mapped = dto.lines.map((l) => ({ tenant, account: l.accountCode, debit: parseMinor(String(l.debit)), credit: parseMinor(String(l.credit)) }));
        expect(mapped.reduce((s, l) => s + l.debit, 0n)).toBe(mapped.reduce((s, l) => s + l.credit, 0n));
        lines.push(...mapped);
        const [row] = await ds.query(`INSERT INTO fin_journal_entries (tenant_id, entry_number, description) VALUES ($1, $2, 'test') RETURNING id`, [tenant, dto.entryNumber]);
        return { id: row.id, entryNumber: dto.entryNumber };
      },
    } as unknown as AccountingService;
    const postingRepo = new PostingRulesRepository(scope);
    const postingRules = new PostingRulesService(postingRepo, accounting);
    for (const t of [T1, T2]) {
      const map: Record<string, string> = {
        receivable: '1201', revenue: '4101', retention_receivable: '1250', contract_insurance_expense: '5250', advance_received: '2250',
        purchases: '5201', payable: '2101', retention_payable: '2260',
      };
      for (const [role, code] of Object.entries(map)) await postingRepo.upsertMapping(t, '*', role, code);
    }
    statutory = new StatutoryService(new StatutoryRepository(scope), { record: async () => undefined } as unknown as AuditService);
    const parties = new PartiesService(new PartiesRepository(scope));
    const projectRepo = new ProjectRepository(scope);
    const contractRepo = new ContractRepository(scope);
    const statementRepo = new StatementRepository(scope);
    const movementRepo = new MovementRepository(scope);
    projects = new ProjectService(projectRepo);
    contracts = new ContractService(contractRepo, projectRepo, parties);
    statements = new StatementService(statementRepo, contractRepo, postingRules, statutory, movementRepo);
    movements = new MovementService(movementRepo, contractRepo, postingRules, statutory);
    const noLedger = { trialBalance: async () => { throw new Error('project has no cost centre'); } } as never;
    profit = new ProfitabilityService(projectRepo, statementRepo, noLedger, { accounts: async () => [] } as never);
    for (const t of [T1, T2]) {
      await parties.create(t, { code: 'C1', name: 'شرکت کارفرمای نمونه', role: 'customer' } as never);
      await parties.create(t, { code: 'S1', name: 'پیمانکار جزء نمونه', role: 'supplier' } as never);
    }
  }, 240_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.destroy();
  });

  const setOrgFigure = (key: string, value: string) =>
    statutory.setValue(T1, USER, { fiscalYear: 1405, key, value, source: 'ثبت‌شده توسط سازمان در آزمون', verified: false });

  async function contractFor(tenant: string, over: Record<string, unknown>) {
    const created = await contracts.create(tenant, {
      title: 'قرارداد نمونه', contractDate: '2026-11-01', ...over,
    } as never);
    return contracts.update(tenant, created.id, { status: 'active' } as never);
  }

  it('refuses, naming the term, while the unemployment addon and the advance cap are unclear (T2 has no organisation figures)', async () => {
    const mech = await contractFor(T2, { code: 'KX', side: 'contractor', partyCode: 'C1', amount: '1000000000', advanceAmount: '100000000', insuranceType: 'MECHANICAL' });
    await expect(movements.advance(T2, mech.id, { date: '2026-11-01', amount: '100000000' })).rejects.toThrow(UnprocessableEntityException);
    await expect(movements.advance(T2, mech.id, { date: '2026-11-01', amount: '100000000' })).rejects.toThrow('سقف پیش‌پرداخت قرارداد');
    const draft = await statements.create(T2, mech.id, { statementDate: '2026-11-10', cumulativeAmount: '300000000' });
    await expect(statements.approve(T2, draft.id)).rejects.toThrow('کسر بیمه بیکاری');
    expect((await statements.getById(T2, draft.id)).status).toBe('draft');
    expect(lines.filter((l) => l.tenant === T2)).toEqual([]);
  });

  it('runs the whole contract: figures, vouchers, release and project report', async () => {
    await setOrgFigure('contract_unemployment_addon_fraction', '0.1');
    await setOrgFigure('contract_advance_payment_max_rate', '0.2');

    const project = await projects.create(T1, { code: 'P1', name: 'ساختمان اداری نمونه', budget: '1500000000' } as never);
    const sale = await contractFor(T1, { code: 'KC', side: 'contractor', partyCode: 'C1', projectId: project.id, amount: '1000000000', advanceAmount: '100000000', insuranceType: 'MECHANICAL' });
    const sub = await contractFor(T1, { code: 'KE', side: 'employer', partyCode: 'S1', projectId: project.id, amount: '400000000' });

    // advance 100,000,000 <= agreed 100,000,000 and <= 20% x 1,000,000,000 = 200,000,000 (the organisation's cap)
    const advance = await movements.advance(T1, sale.id, { date: '2026-11-01', amount: '100000000', requestKey: 'adv-1' });
    expect(advance.termsUsed).toEqual([expect.objectContaining({ key: 'contract_advance_payment_max_rate', tenantOverride: true, legalFact: false })]);
    expect((await movements.advance(T1, sale.id, { date: '2026-11-01', amount: '100000000', requestKey: 'adv-1' })).replayed).toBe(true);
    await expect(movements.advance(T1, sale.id, { date: '2026-11-02', amount: '1' })).rejects.toThrow('مبلغ توافق‌شده');

    // statement 1: cumulative 300m. period 300m; retention 10% = 30m; insurance 7% x 1.1 = 23.1m; recovery 100m x 30% = 30m; net 216.9m
    // statement 2: cumulative 700m. period 400m; retention 40m; insurance 30.8m; recovery 70m - 30m = 40m; net 289.2m
    // statement 3: cumulative 1,000m. period 300m; retention 30m; insurance 23.1m; recovery 100m - 70m = 30m; net 216.9m
    const expected = [
      { cum: '300000000', date: '2026-11-10', period: 300, ret: 30, ins: 231n, rec: 30, net: 2169n },
      { cum: '700000000', date: '2026-12-01', period: 400, ret: 40, ins: 308n, rec: 40, net: 2892n },
      { cum: '1000000000', date: '2027-01-01', period: 300, ret: 30, ins: 231n, rec: 30, net: 2169n },
    ];
    for (const [i, e] of expected.entries()) {
      const created = await statements.create(T1, sale.id, { statementDate: e.date, cumulativeAmount: e.cum });
      expect(created.number).toBe(i + 1);
      const approved = await statements.approve(T1, created.id);
      expect(BigInt(Math.round(Number(approved.periodAmount) * 100))).toBe(rial(e.period));
      expect(BigInt(Math.round(Number(approved.retentionAmount) * 100))).toBe(rial(e.ret));
      expect(BigInt(Math.round(Number(approved.insuranceAmount) * 100))).toBe(rialFrac(e.ins));
      expect(BigInt(Math.round(Number(approved.advanceRecoveryAmount) * 100))).toBe(rial(e.rec));
      expect(BigInt(Math.round(Number(approved.netPayable) * 100))).toBe(rialFrac(e.net));
      if (i === 0) {
        expect(approved.termsUsed.map((t) => [t.key, t.tenantOverride, t.legalFact])).toEqual([
          ['contract_retention_rate', false, false], ['contract_insurance_rate_mechanical', false, false], ['contract_unemployment_addon_fraction', true, false],
        ]);
      }
      const posted = await statements.post(T1, created.id);
      expect(posted).toMatchObject({ status: 'posted', replayed: false });
      expect((await statements.post(T1, created.id)).replayed).toBe(true); // replay writes nothing
    }

    // retention held 30m + 40m + 30m = 100m; release 50m, then 50,000,001 is above the remaining 50m
    await movements.releaseRetention(T1, sale.id, { date: '2027-02-01', amount: '50000000', requestKey: 'rel-1' });
    await expect(movements.releaseRetention(T1, sale.id, { date: '2027-02-02', amount: '50000001' })).rejects.toThrow('بیشتر');

    // employer-side contract: one statement of 400m, retention 40m kept, net 360m owed to the subcontractor
    const subStatement = await statements.create(T1, sub.id, { statementDate: '2026-12-15', cumulativeAmount: '400000000' });
    await statements.approve(T1, subStatement.id);
    await statements.post(T1, subStatement.id);

    // ledger (net debit per account, minor units). Contractor: 1201 = 100 + 216.9 + 289.2 + 216.9 + 50 = 873.0m;
    // 1250 = 30 + 40 + 30 - 50 = 50m; 5250 = 23.1 + 30.8 + 23.1 = 77m; 2250 = -100 + 30 + 40 + 30 = 0; 4101 = -1,000m.
    // Employer: 5201 = 400m; 2101 = -360m; 2260 = -40m.
    expect(net(T1)).toEqual({
      '1201': rial(873), '1250': rial(50), '5250': rial(77), '2250': 0n, '4101': -rial(1000),
      '5201': rial(400), '2101': -rial(360), '2260': -rial(40),
    });
    expect(Object.values(net(T1)).reduce((s, v) => s + v, 0n)).toBe(0n);

    // project: budget 1,500m; billed 1,000m (contractor statements); actual 400m (subcontract statement), ledger unknown
    const report = await profit.report(T1, {});
    expect(report.projects).toEqual([
      expect.objectContaining({ code: 'P1', budget: 1500000000, billed: 1000000000, budgetRemaining: 1100000000, margin: 600000000, ledgerLinked: false, actual: { subcontracts: 400000000, ledger: null, total: 400000000 } }),
    ]);
  }, 120_000);
});
