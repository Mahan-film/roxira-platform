/**
 * Real PostgreSQL integration test for FX Revaluation (T75 / #736):
 * - Runs as a uniquely named NOSUPERUSER NOBYPASSRLS role (`rx_fx_app_*`).
 * - Exercises real TypeORM migrations, FORCE RLS, SELECT ... FOR UPDATE row locking,
 *   amount_fx ledger cross-check, idempotent replay vs 409 date/param conflict,
 *   concurrent identical runs under lock, reversal + :r1 re-posting, and tenant isolation.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountLevel, AccountType } from '../accounting/enums/accounting.enum';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { Currency } from './enums/currency.enum';
import { CurrencyService } from './services/currency.service';
import { ForeignAccountBalance, FxRevaluationService } from './services/fx-revaluation.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const baseOptions = (database: string, username: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
  extra: { max: 10 },
});

const adminQuery = async (sql: string) => {
  const admin = new DataSource({
    ...baseOptions('postgres', ADMIN_USER),
    entities: [],
    migrations: [],
  });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

describePg('FX Revaluation on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const dbName = `rx_fx_pg_${suffix}`;
  const appRole = `rx_fx_app_${suffix}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let accountingService: AccountingService;
  let postingRulesService: PostingRulesService;
  let fxRevaluationService: FxRevaluationService;

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    await adminQuery(
      `CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );

    ownerDs = new DataSource(baseOptions(dbName, ADMIN_USER));
    await ownerDs.initialize();
    await ownerDs.runMigrations();

    for (const tid of [TENANT_A, TENANT_B]) {
      await ownerDs.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
        [tid, `fx-${tid.slice(0, 8)}`],
      );
    }

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${appRole}"`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
    await ownerDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`,
    );
    await ownerDs.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`,
    );

    appDs = new DataSource(baseOptions(dbName, appRole));
    await appDs.initialize();
    scope = new TenantScope(appDs);

    const configService = {
      get: (_k: string, defaultVal: string) => defaultVal,
    } as unknown as ConfigService;
    const currencyService = new CurrencyService(configService);
    const accountingRepo = new AccountingRepository(scope);
    accountingService = new AccountingService(accountingRepo, currencyService);
    const postingRulesRepo = new PostingRulesRepository(scope);
    postingRulesService = new PostingRulesService(postingRulesRepo, accountingService);

    const moduleRef = {
      get: (token: unknown) => {
        if (token === PostingRulesService) return postingRulesService;
        if (token === AccountingService) return accountingService;
        return null;
      },
    } as unknown as ModuleRef;

    fxRevaluationService = new FxRevaluationService(currencyService, moduleRef, scope);

    // Seed Tenant A chart via listAccounts, create FX bank asset 1019 (USD), FX AP 2015 (USD), and opening FX entries
    await accountingService.listAccounts(TENANT_A);
    await accountingService.createAccount(TENANT_A, {
      code: '1019',
      name: 'بانک ارزی دلاری',
      accountType: AccountType.ASSET,
      level: AccountLevel.TAFSILI,
      parentCode: '1010',
      currency: Currency.USD,
    });
    await accountingService.createAccount(TENANT_A, {
      code: '2015',
      name: 'حساب پرداختنی تجاری دلاری',
      accountType: AccountType.LIABILITY,
      level: AccountLevel.TAFSILI,
      parentCode: '2010',
      currency: Currency.USD,
    });
    await accountingService.createAccount(TENANT_A, {
      code: '4120',
      name: 'درآمد تسعیر ارز',
      accountType: AccountType.REVENUE,
      level: AccountLevel.MOEIN,
      currency: Currency.IRR,
    });
    await accountingService.createAccount(TENANT_A, {
      code: '5210',
      name: 'هزینه‌های مالی و تسعیر ارز',
      accountType: AccountType.EXPENSE,
      level: AccountLevel.MOEIN,
      currency: Currency.IRR,
    });

    // Opening FX entries: 10,000 USD asset @ 850,000 IRR and 10,000 USD AP @ 800,000 IRR
    await accountingService.createJournalEntry(TENANT_A, {
      date: '2026-10-01',
      description: 'افتتاحیه حساب ارزی دلاری',
      lines: [
        {
          accountCode: '1019',
          debit: 8_500_000_000,
          credit: 0,
          currency: Currency.USD,
          amountFx: 10_000,
          fxRate: 850_000,
        },
        {
          accountCode: '3010',
          debit: 0,
          credit: 8_500_000_000,
        },
      ],
    });

    await accountingService.createJournalEntry(TENANT_A, {
      date: '2026-10-02',
      description: 'ثبت بدهی پرداختنی دلاری',
      lines: [
        {
          accountCode: '5010',
          debit: 8_000_000_000,
          credit: 0,
        },
        {
          accountCode: '2015',
          debit: 0,
          credit: 8_000_000_000,
          currency: Currency.USD,
          amountFx: 10_000,
          fxRate: 800_000,
        },
      ],
    });
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminQuery(`DROP ROLE IF EXISTS "${appRole}"`);
  });

  it('rejects tampered foreignAmountMinor when ledger amount_fx disagrees', async () => {
    await expect(
      fxRevaluationService.postMonthEndRevaluation(TENANT_A, {
        period: '1405-07',
        date: '2026-10-22',
        balances: [
          {
            accountCode: '1019',
            accountName: 'بانک ارزی دلاری',
            currency: Currency.USD,
            foreignAmountMinor: 2_000_000n, // real amount_fx sum is 1,000,000n cents ($10,000)
            bookValueRialMinor: 850_000_000_000n,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('posts gain voucher, replays identically, rejects date-change with 409, and re-posts under :r1 after reversal', async () => {
    const balance: ForeignAccountBalance = {
      accountCode: '1019',
      accountName: 'بانک ارزی دلاری',
      currency: Currency.USD,
      foreignAmountMinor: 1_000_000n,
      bookValueRialMinor: 850_000_000_000n,
    };

    // 1. Post Gain (+70B minor = 700M IRR) at 920,000 IRR/USD
    const first = await fxRevaluationService.postMonthEndRevaluation(TENANT_A, {
      period: '1405-08',
      date: '2026-11-21',
      balances: [balance],
      rates: { [Currency.USD]: 920_000n },
    });
    expect(first.postingResults).toHaveLength(1);
    expect(first.postingResults[0].replayed).toBe(false);

    // 2. Identical rerun replays cleanly (even though account balance in DB is now 920B minor)
    const replay = await fxRevaluationService.postMonthEndRevaluation(TENANT_A, {
      period: '1405-08',
      date: '2026-11-21',
      balances: [balance],
      rates: { [Currency.USD]: 920_000n },
    });
    expect(replay.postingResults[0]).toEqual({
      entryId: first.postingResults[0].entryId,
      entryNumber: first.postingResults[0].entryNumber,
      replayed: true,
    });

    // 3. Date-change rerun returns HTTP 409 ConflictException
    await expect(
      fxRevaluationService.postMonthEndRevaluation(TENANT_A, {
        period: '1405-08',
        date: '2026-11-22',
        balances: [balance],
        rates: { [Currency.USD]: 920_000n },
      }),
    ).rejects.toThrow(ConflictException);

    // 4. Reverse the voucher through PostingRulesService -> restores balance to 850B minor
    await postingRulesService.reverse(
      TENANT_A,
      'currency.fx_revaluation',
      'currency_revaluation',
      '1405-08:1019:USD',
      { date: '2026-11-21', reason: 'اصلاح نرخ پایان ماه' },
    );

    // 5. Re-post corrected rate (950,000 IRR/USD -> +100B minor) -> posts under :r1
    const apost = await fxRevaluationService.postMonthEndRevaluation(TENANT_A, {
      period: '1405-08',
      date: '2026-11-21',
      balances: [balance],
      rates: { [Currency.USD]: 950_000n },
    });
    expect(apost.postingResults[0].replayed).toBe(false);
    expect(apost.postingResults[0].entryId).not.toBe(first.postingResults[0].entryId);

    const srcR1 = await postingRulesService.findSource(
      TENANT_A,
      'currency_revaluation',
      '1405-08:1019:USD:r1',
      'currency.fx_revaluation',
    );
    expect(srcR1?.entryId).toBe(apost.postingResults[0].entryId);
  });

  it('serializes concurrent identical runs via SELECT ... FOR UPDATE with one post and one replay (no 400/double-post)', async () => {
    // Current balance on 2015 AP USD is 800_000_000_000n (credit-nature natural)
    const apBalance: ForeignAccountBalance = {
      accountCode: '2015',
      accountName: 'حساب پرداختنی تجاری دلاری',
      currency: Currency.USD,
      foreignAmountMinor: 1_000_000n,
      bookValueRialMinor: 800_000_000_000n,
      isLiability: true,
    };

    const req = {
      period: '1405-09',
      date: '2026-12-21',
      balances: [apBalance],
      rates: { [Currency.USD]: 900_000n },
    };

    const [res1, res2] = await Promise.all([
      fxRevaluationService.postMonthEndRevaluation(TENANT_A, req),
      fxRevaluationService.postMonthEndRevaluation(TENANT_A, req),
    ]);

    const flags = [res1.postingResults[0].replayed, res2.postingResults[0].replayed].sort();
    expect(flags).toEqual([false, true]);
    expect(res1.postingResults[0].entryId).toBe(res2.postingResults[0].entryId);
  });

  it('enforces tenant RLS isolation so Tenant B cannot revalue Tenant A accounts', async () => {
    await expect(
      fxRevaluationService.postMonthEndRevaluation(TENANT_B, {
        period: '1405-08',
        date: '2026-11-21',
        balances: [
          {
            accountCode: '1019',
            accountName: 'بانک ارزی دلاری',
            currency: Currency.USD,
            foreignAmountMinor: 1_000_000n,
            bookValueRialMinor: 850_000_000_000n,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
