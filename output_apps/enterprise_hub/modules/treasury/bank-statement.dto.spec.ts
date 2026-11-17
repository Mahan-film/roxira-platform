import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import {
  ConfirmStatementMatchDto,
  ImportBankStatementDto,
  MAX_STATEMENT_CHARS,
  QueryBankStatementLinesDto,
  UpdateStatementSettingsDto,
} from './dto/bank-statement.dto';

// the same options as main.ts uses globally
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const run = (type: new () => object, value: unknown) => pipe.transform(value, { type: 'body', metatype: type });

describe('bank statement DTOs', () => {
  it('accepts a valid import; the old per-request autoMatch flag is gone (an import never posts by itself)', async () => {
    await expect(run(ImportBankStatementDto, { bankAccountId: 3, content: '<Document/>' })).resolves.toBeDefined();
    await expect(run(ImportBankStatementDto, { bankAccountId: 3, content: '<Document/>', autoMatch: true })).rejects.toBeDefined();
  });

  it('settings: a real boolean is required, "false" is not coerced to true', async () => {
    await expect(run(UpdateStatementSettingsDto, { autoPostExactMatches: false })).resolves.toMatchObject({ autoPostExactMatches: false });
    await expect(run(UpdateStatementSettingsDto, { autoPostExactMatches: 'false' })).rejects.toBeDefined();
    await expect(run(UpdateStatementSettingsDto, {})).rejects.toBeDefined();
  });

  it('refuses a bad account id, an empty or oversized file, an unknown format and unknown fields', async () => {
    await expect(run(ImportBankStatementDto, { bankAccountId: 0, content: 'x' })).rejects.toBeDefined();
    await expect(run(ImportBankStatementDto, { bankAccountId: 1, content: '' })).rejects.toBeDefined();
    await expect(run(ImportBankStatementDto, { bankAccountId: 1, content: 'x'.repeat(MAX_STATEMENT_CHARS + 1) })).rejects.toBeDefined();
    await expect(run(ImportBankStatementDto, { bankAccountId: 1, content: 'x', format: 'csv' })).rejects.toBeDefined();
    await expect(run(ImportBankStatementDto, { bankAccountId: 1, content: 'x', tenantId: 'other' })).rejects.toBeDefined();
  });

  it('confirm: money as exact decimal strings, uuid invoice ids, bounded rows', async () => {
    const id = 'a0000000-0000-4000-8000-000000000102';
    await expect(run(ConfirmStatementMatchDto, { allocations: [{ invoiceId: id, amount: '600.00' }], fee: '30.00' })).resolves.toBeDefined();
    await expect(run(ConfirmStatementMatchDto, {})).resolves.toBeDefined();
    await expect(run(ConfirmStatementMatchDto, { allocations: [] })).rejects.toBeDefined();
    await expect(run(ConfirmStatementMatchDto, { allocations: [{ invoiceId: 'nope', amount: '1' }] })).rejects.toBeDefined();
    await expect(run(ConfirmStatementMatchDto, { allocations: [{ invoiceId: id, amount: '1.234' }] })).rejects.toBeDefined();
    await expect(run(ConfirmStatementMatchDto, { allocations: [{ invoiceId: id, amount: 'abc' }] })).rejects.toBeDefined();
    await expect(run(ConfirmStatementMatchDto, { fee: '-1' })).rejects.toBeDefined();
  });

  it('list query: numeric strings are converted, limits are bounded', async () => {
    await expect(run(QueryBankStatementLinesDto, { bankAccountId: '4', limit: '50' })).resolves.toMatchObject({ bankAccountId: 4, limit: 50 });
    await expect(run(QueryBankStatementLinesDto, { bankAccountId: '4', limit: '501' })).rejects.toBeDefined();
    await expect(run(QueryBankStatementLinesDto, { bankAccountId: '4', status: 'bogus' })).rejects.toBeDefined();
  });
});
