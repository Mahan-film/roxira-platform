import { BadRequestException } from '@nestjs/common';
import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import { chartOfAccountsTable, ChartAccountRow } from '../../accounting/reports/report-tables';
import { writeXlsx } from '../../accounting/reports/xlsx-writer';
import { AccountingImportAccountInput, AccountingService } from '../../accounting/services/accounting.service';
import { parseXlsx } from '../parsers/xlsx.parser';
import { AccountingAccountsRegistry } from './accounting-accounts.registry';
import { buildEntityFallbackMapping, locateHeaderRow } from './entity-detect';
import { normaliseText } from '../normaliser/normalise';
import { normaliseAndValidate } from './field-validation';
import { NormalisedRecord } from './import-registry.types';

const chart: ChartAccountRow[] = [
  { code: '1', name: 'دارایی‌های جاری', accountType: AccountType.ASSET, level: AccountLevel.GROUP, parentCode: null, currency: 'IRR' },
  { code: '11', name: 'موجودی نقد', accountType: AccountType.ASSET, level: AccountLevel.KOL, parentCode: '1', currency: 'IRR' },
  { code: '1101', name: 'صندوق', accountType: AccountType.ASSET, level: AccountLevel.MOEIN, parentCode: '11', currency: 'IRR' },
  { code: '110101', name: 'صندوق دفتر مرکزی', accountType: AccountType.ASSET, level: AccountLevel.TAFSILI, parentCode: '1101', currency: 'USD' },
  { code: '5101', name: 'هزینه حقوق', accountType: AccountType.EXPENSE, level: null, parentCode: null, currency: 'IRR' },
];

/** The import pipeline up to commit: parse, find the header row, map headers, normalise and validate. */
function records(registry: AccountingAccountsRegistry, buffer: Buffer): NormalisedRecord[] {
  const parsed = parseXlsx(buffer, (rows) => locateHeaderRow(rows, [registry]));
  const mapping = buildEntityFallbackMapping(registry.fields, parsed.headers);
  return parsed.rows.map((row, index) => {
    const values: Record<string, unknown> = {};
    parsed.headers.forEach((header, column) => {
      const key = mapping[header];
      const field = registry.fields.find((candidate) => candidate.key === key);
      if (!field) return;
      const { value, error } = normaliseAndValidate(field, row[column] ?? '');
      expect(error).toBeNull();
      values[key] = value;
    });
    return { rowNumber: index + 2, values };
  });
}

describe('accounts import: chart hierarchy round trip', () => {
  it('maps the exported level and parent columns and passes them to the ledger', async () => {
    const received: AccountingImportAccountInput[] = [];
    const service = {
      importAccounts: jest.fn(async (_tenant: string, inputs: AccountingImportAccountInput[]) => {
        received.push(...inputs);
        return inputs.map((_, i) => received.length + i);
      }),
    } as unknown as AccountingService;
    const registry = new AccountingAccountsRegistry(service);

    const result = await registry.commit('t', records(registry, writeXlsx(chartOfAccountsTable(chart))));

    expect(result.failed).toEqual([]);
    expect(received).toEqual(
      chart.map((account) => ({
        code: account.code,
        // Text fields go through normaliseText (ZWNJ becomes a space today; see the PR notes).
        name: normaliseText(account.name),
        accountType: account.accountType,
        currency: account.currency,
        ...(account.level ? { level: account.level } : {}),
        ...(account.parentCode ? { parentCode: account.parentCode } : {}),
      })),
    );
  });

  it.each([
    ['گروه', AccountLevel.GROUP],
    ['کل', AccountLevel.KOL],
    ['معین', AccountLevel.MOEIN],
    ['تفضیلی', AccountLevel.TAFSILI],
    ['MOEIN', AccountLevel.MOEIN],
  ])('reads level %s', (raw, level) => {
    const field = new AccountingAccountsRegistry({} as AccountingService).fields.find((f) => f.key === 'level')!;
    expect(normaliseAndValidate(field, raw)).toEqual({ value: level, error: null });
  });
});

describe('AccountingService.importAccounts hierarchy', () => {
  function service(existing: string[]) {
    const created: Array<Record<string, unknown>> = [];
    const svc = Object.create(AccountingService.prototype) as AccountingService;
    Object.assign(svc, {
      accountingRepository: {
        findAccountByCode: jest.fn(async (_t: string, code: string) =>
          existing.includes(code) || created.some((row) => row.code === code) ? { code } : null,
        ),
        createAccount: jest.fn(async (_t: string, row: Record<string, unknown>) => {
          created.push(row);
          return { id: created.length };
        }),
      },
    });
    return { svc, created };
  }

  it('stores level and parent, allowing a parent created earlier in the same import', async () => {
    const { svc, created } = service(['1']);
    await svc.importAccounts('t', [
      { code: '11', name: 'موجودی نقد', accountType: AccountType.ASSET, level: AccountLevel.KOL, parentCode: '1' },
      { code: '1101', name: 'صندوق', accountType: AccountType.ASSET, parentCode: '11' },
    ]);
    expect(created.map((row) => [row.code, row.level, row.parentCode])).toEqual([
      ['11', AccountLevel.KOL, '1'],
      ['1101', null, '11'],
    ]);
  });

  it('refuses a parent that does not exist', async () => {
    const { svc, created } = service([]);
    await expect(
      svc.importAccounts('t', [{ code: '1101', name: 'صندوق', accountType: AccountType.ASSET, parentCode: '11' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toEqual([]);
  });
});
