import * as fs from 'fs';
import * as path from 'path';
import { PartiesRegistry } from './parties.registry';
import { PartiesService } from '../../parties/services/parties.service';
import { normaliseAndValidate } from './field-validation';
import { scoreEntityHeaders } from './entity-detect';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { NormalisedRecord } from './import-registry.types';

describe('PartiesRegistry', () => {
  const mockPartiesService = {
    findExistingCodes: jest.fn(),
    upsertMany: jest.fn(),
    removeByIds: jest.fn(),
  } as unknown as PartiesService;

  const registry = new PartiesRegistry(mockPartiesService);

  it('duplicateKeys of code " CUST-001 " is ["code:CUST-001"]', () => {
    const record = { values: { code: ' CUST-001 ' } } as unknown as NormalisedRecord;
    expect(registry.duplicateKeys(record)).toEqual(['code:CUST-001']);
  });

  it('role normalisation', () => {
    const roleField = registry.fields.find((f) => f.key === 'role')!;
    
    expect(normaliseAndValidate(roleField, 'مشتری').value).toBe(PartyRole.CUSTOMER);
    // 'تأمین‌کننده' (with ZWNJ U+200C)
    expect(normaliseAndValidate(roleField, 'تأمین‌کننده').value).toBe(PartyRole.SUPPLIER);
    // 'تأمین كننده' with Arabic kaf (and standard space)
    expect(normaliseAndValidate(roleField, 'تأمین كننده').value).toBe(PartyRole.SUPPLIER);
    expect(normaliseAndValidate(roleField, 'هر دو').value).toBe(PartyRole.BOTH);
    expect(normaliseAndValidate(roleField, 'نامعتبر').error).not.toBeNull();
  });

  it('name normalisation (Persian ی/ک)', () => {
    const nameField = registry.fields.find((f) => f.key === 'name')!;
    // 'علي كريمي' -> 'علی کریمی'
    expect(normaliseAndValidate(nameField, 'علي كريمي').value).toBe('علی کریمی');
  });

  it('commit validation', async () => {
    mockPartiesService.upsertMany = jest.fn().mockResolvedValue([]);
    
    const record = {
      rowNumber: 1,
      values: {
        code: 'C001',
        name: 'Test',
        role: PartyRole.CUSTOMER,
        nationalId: '12345678901', // 11 digits
        economicCode: '1234567890',
      },
    } as unknown as NormalisedRecord;
    
    const result = await registry.commit('tenant1', [record]);
    expect(mockPartiesService.upsertMany).toHaveBeenCalledWith('tenant1', [
      {
        code: 'C001',
        name: 'Test',
        role: PartyRole.CUSTOMER,
        nationalId: '12345678901',
        economicCode: '1234567890',
        phone: null,
        email: null,
      },
    ]);
    expect(result.failed).toHaveLength(0);

    const badRecord = {
      rowNumber: 2,
      values: {
        code: 'C002',
        name: 'Test',
        role: PartyRole.CUSTOMER,
        nationalId: '123', // Invalid
      },
    } as unknown as NormalisedRecord;

    const result2 = await registry.commit('tenant1', [badRecord]);
    expect(result2.failed).toHaveLength(1);
    expect(result2.failed[0].rowNumber).toBe(2);
  });

  it('reports inserted:false upsert results as failed', async () => {
    mockPartiesService.upsertMany = jest.fn().mockResolvedValue([
      { code: 'C001', id: 1, inserted: false }
    ]);
    
    const record = {
      rowNumber: 1,
      values: { code: 'C001', name: 'Test', role: PartyRole.CUSTOMER },
    } as unknown as NormalisedRecord;
    
    const result = await registry.commit('tenant1', [record]);
    expect(result.inserted).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].message).toBe('کد طرف حساب قبلاً ثبت شده است.');
  });

  it('findExistingDuplicateKeys returns prefixed keys', async () => {
    mockPartiesService.findExistingCodes = jest.fn().mockResolvedValue(['C001']);
    const result = await registry.findExistingDuplicateKeys('tenant1', ['code:C001']);
    expect(result).toEqual(['code:C001']);
  });

  it('headers detection score', () => {
    const headers = ['کد طرف حساب', 'نقش', 'نام و نام خانوادگی', 'شناسه ملی / کد اقتصادی آزمایشی', 'تلفن', 'رایانامه'];
    const score = scoreEntityHeaders(headers, registry);
    expect(score).toBeGreaterThanOrEqual(6);
  });

  it('sample company file: 48 unique codes (29 customers, 19 suppliers), every role and id accepted', () => {
    const file = path.resolve(__dirname, '../../../../../e2e/fixtures/sample-company/customers-suppliers.csv');
    const [headerLine, ...lines] = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const header = headerLine.split(',');
    const mapping: Record<string, string | null> = {
      'کد طرف حساب': 'code',
      'نقش': 'role',
      'نام و نام خانوادگی': 'name',
      'شناسه ملی / کد اقتصادی آزمایشی': 'nationalId',
    };
    const seen = new Set<string>();
    const roles: Record<string, number> = { customer: 0, supplier: 0, both: 0 };
    let rows = 0;
    for (const line of lines) {
      const cells = line.split(',');
      const values: Record<string, unknown> = {};
      for (const [column, key] of Object.entries(mapping)) {
        const field = registry.fields.find((f) => f.key === key)!;
        const out = normaliseAndValidate(field, cells[header.indexOf(column)]);
        expect(out.error).toBeNull();
        values[key!] = out.value;
      }
      rows += 1;
      const [dupKey] = registry.duplicateKeys({ rowNumber: rows + 1, values });
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      roles[values.role as string] += 1;
      expect(String(values.nationalId)).toMatch(/^\d{11}$/);
    }
    expect(rows).toBe(50);
    expect(seen.size).toBe(48);
    expect(roles).toEqual({ customer: 29, supplier: 19, both: 0 });
  });
});
