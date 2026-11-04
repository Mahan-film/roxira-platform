import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  AllocateAdvanceDto,
  AllocationRowDto,
  CreateTreasuryDocumentDto,
  QueryAllocationsDto,
  QueryTreasuryDocumentsDto,
  SetToleranceDto,
  TreasuryMethodLineDto,
} from './treasury.dto';
import { TreasuryDocKind, TreasuryMethod, TreasuryPartyType } from '../enums/treasury.enum';

const INVOICE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const parse = <T extends object>(cls: new () => T, payload: Record<string, unknown>): T =>
  plainToInstance(cls, payload);

/** Every property named by a validation error, including nested children. */
function errorProps(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [error.property, ...errorProps(error.children ?? [])]);
}

async function expectValid<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): Promise<void> {
  const dto = parse(cls, payload);
  expect(await validate(dto)).toHaveLength(0);
}

async function expectInvalid<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
  property: string,
): Promise<void> {
  const errors = await validate(parse(cls, payload));
  expect(errors.length).toBeGreaterThan(0);
  expect(errorProps(errors)).toContain(property);
}

describe('TreasuryMethodLineDto', () => {
  const valid = {
    method: TreasuryMethod.CASH,
    amount: '50000000.00',
  };

  it('accepts a valid cash method line', async () => {
    await expectValid(TreasuryMethodLineDto, valid);
  });

  it('rejects an unknown method enum value on "method"', async () => {
    await expectInvalid(TreasuryMethodLineDto, { ...valid, method: 'bitcoin' }, 'method');
  });

  it('rejects a malformed money string on "amount"', async () => {
    await expectInvalid(TreasuryMethodLineDto, { ...valid, amount: '-5' }, 'amount');
  });

  it('rejects an invalid ISO date on "dueDate"', async () => {
    await expectInvalid(TreasuryMethodLineDto, { ...valid, dueDate: 'yesterday' }, 'dueDate');
  });

  it('accepts a cheque line with a valid due date', async () => {
    await expectValid(TreasuryMethodLineDto, {
      method: TreasuryMethod.CHEQUE,
      amount: 1000,
      dueDate: '2026-11-04',
    });
  });
});

describe('AllocationRowDto', () => {
  const valid = { invoiceId: INVOICE_ID, amount: 1000 };

  it('accepts a valid allocation row', async () => {
    await expectValid(AllocationRowDto, valid);
  });

  it('rejects a missing invoiceId on "invoiceId"', async () => {
    await expectInvalid(AllocationRowDto, { amount: 1000 }, 'invoiceId');
  });

  it('rejects a malformed money amount on "amount"', async () => {
    await expectInvalid(AllocationRowDto, { ...valid, amount: '12.345' }, 'amount');
  });
});

describe('CreateTreasuryDocumentDto', () => {
  const valid = {
    kind: TreasuryDocKind.RECEIPT,
    partyType: TreasuryPartyType.CUSTOMER,
    partyCode: 'C-001',
    partyName: 'Acme',
    docDate: '2026-11-04',
    methods: [{ method: TreasuryMethod.CASH, amount: '50000000.00' }],
  };

  it('accepts a valid receipt document', async () => {
    await expectValid(CreateTreasuryDocumentDto, valid);
  });

  it('rejects a missing required partyName on "partyName"', async () => {
    await expectInvalid(
      CreateTreasuryDocumentDto,
      {
        kind: TreasuryDocKind.RECEIPT,
        partyType: TreasuryPartyType.CUSTOMER,
        partyCode: 'C-001',
        docDate: '2026-11-04',
        methods: [{ method: TreasuryMethod.CASH, amount: '50000000.00' }],
      },
      'partyName',
    );
  });

  it('rejects an invalid ISO docDate on "docDate"', async () => {
    await expectInvalid(CreateTreasuryDocumentDto, { ...valid, docDate: 'not-a-date' }, 'docDate');
  });

  it('rejects an empty methods array on "methods"', async () => {
    await expectInvalid(CreateTreasuryDocumentDto, { ...valid, methods: [] }, 'methods');
  });

  it('rejects a malformed nested method amount on "amount"', async () => {
    await expectInvalid(
      CreateTreasuryDocumentDto,
      { ...valid, methods: [{ method: TreasuryMethod.CASH, amount: '-1' }] },
      'amount',
    );
  });
});

describe('AllocateAdvanceDto', () => {
  const valid = { allocations: [{ invoiceId: INVOICE_ID, amount: 1000 }] };

  it('accepts a valid allocation list', async () => {
    await expectValid(AllocateAdvanceDto, valid);
  });

  it('rejects an empty allocations array on "allocations"', async () => {
    await expectInvalid(AllocateAdvanceDto, { allocations: [] }, 'allocations');
  });

  it('rejects an invalid optional date on "date"', async () => {
    await expectInvalid(AllocateAdvanceDto, { ...valid, date: 'nope' }, 'date');
  });
});

describe('QueryTreasuryDocumentsDto', () => {
  it('accepts an empty query (all fields optional)', async () => {
    await expectValid(QueryTreasuryDocumentsDto, {});
  });

  it('rejects an unknown kind enum value on "kind"', async () => {
    await expectInvalid(QueryTreasuryDocumentsDto, { kind: 'nope' }, 'kind');
  });

  it('rejects an invalid from date on "from"', async () => {
    await expectInvalid(QueryTreasuryDocumentsDto, { from: 'nope' }, 'from');
  });
});

describe('SetToleranceDto', () => {
  it('accepts a zero tolerance', async () => {
    await expectValid(SetToleranceDto, { writeoffTolerance: 0 });
  });

  it('rejects a negative money value on "writeoffTolerance"', async () => {
    await expectInvalid(SetToleranceDto, { writeoffTolerance: '-1' }, 'writeoffTolerance');
  });

  it('rejects a missing tolerance on "writeoffTolerance"', async () => {
    await expectInvalid(SetToleranceDto, {}, 'writeoffTolerance');
  });
});

describe('QueryAllocationsDto', () => {
  it('accepts an empty query (all fields optional)', async () => {
    await expectValid(QueryAllocationsDto, {});
  });

  it('rejects an invalid asOf date on "asOf"', async () => {
    await expectInvalid(QueryAllocationsDto, { asOf: 'nope' }, 'asOf');
  });
});
