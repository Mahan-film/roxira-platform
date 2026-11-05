import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreatePartyDto, QueryPartiesDto, UpdatePartyDto } from './dto/party.dto';
import { PartyRole } from './enums/party-role.enum';

const parse = <T extends object>(cls: new () => T, payload: Record<string, unknown>): T =>
  plainToInstance(cls, payload);

/** Every property named by a validation error, including nested children. */
function errorProps(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [error.property, ...errorProps(error.children ?? [])]);
}

async function expectValid<T extends object>(cls: new () => T, payload: Record<string, unknown>): Promise<void> {
  expect(await validate(parse(cls, payload))).toHaveLength(0);
}

async function expectInvalid<T extends object>(cls: new () => T, payload: Record<string, unknown>, property: string): Promise<void> {
  const errors = await validate(parse(cls, payload));
  expect(errors.length).toBeGreaterThan(0);
  expect(errorProps(errors)).toContain(property);
}

describe('CreatePartyDto', () => {
  const valid = { code: 'C-100', name: 'مشتری الف', role: PartyRole.CUSTOMER };

  it('accepts a minimal valid party', async () => {
    await expectValid(CreatePartyDto, valid);
  });

  it('accepts 10 and 11 digit national ids', async () => {
    await expectValid(CreatePartyDto, { ...valid, nationalId: '1234567890' });
    await expectValid(CreatePartyDto, { ...valid, nationalId: '12345678901' });
  });

  it('rejects a 9 digit and a 12 digit national id', async () => {
    await expectInvalid(CreatePartyDto, { ...valid, nationalId: '123456789' }, 'nationalId');
    await expectInvalid(CreatePartyDto, { ...valid, nationalId: '123456789012' }, 'nationalId');
  });

  it('accepts 10 to 14 digit economic codes and rejects shorter ones', async () => {
    await expectValid(CreatePartyDto, { ...valid, economicCode: '1234567890' });
    await expectValid(CreatePartyDto, { ...valid, economicCode: '12345678901234' });
    await expectInvalid(CreatePartyDto, { ...valid, economicCode: '123456789' }, 'economicCode');
    await expectInvalid(CreatePartyDto, { ...valid, economicCode: '123456789012345' }, 'economicCode');
  });

  it('rejects a code with a space', async () => {
    await expectInvalid(CreatePartyDto, { ...valid, code: 'C 100' }, 'code');
  });

  it('rejects an unknown role (values are exactly customer, supplier, both)', async () => {
    await expectInvalid(CreatePartyDto, { ...valid, role: 'partner' }, 'role');
    await expectValid(CreatePartyDto, { ...valid, role: PartyRole.BOTH });
    await expectValid(CreatePartyDto, { ...valid, role: PartyRole.SUPPLIER });
  });

  it('rejects a bad email and a bad phone', async () => {
    await expectInvalid(CreatePartyDto, { ...valid, email: 'not-an-email' }, 'email');
    await expectInvalid(CreatePartyDto, { ...valid, phone: '12345' }, 'phone');
    await expectValid(CreatePartyDto, { ...valid, phone: '+982112345678' });
  });

  it('rejects a name longer than 200 characters', async () => {
    await expectInvalid(CreatePartyDto, { ...valid, name: 'ا'.repeat(201) }, 'name');
  });
});

describe('UpdatePartyDto', () => {
  it('accepts an empty patch and every field optional, with no code property to update', async () => {
    await expectValid(UpdatePartyDto, {});
    await expectValid(UpdatePartyDto, { name: 'نو', role: PartyRole.BOTH, active: false });
  });
});

describe('QueryPartiesDto', () => {
  it('defaults to limit 50 and offset 0 and transforms the active string to boolean', async () => {
    const query = parse(QueryPartiesDto, {});
    expect(await validate(query)).toHaveLength(0);
    expect(query.limit).toBe(50);
    expect(query.offset).toBe(0);
    expect(parse(QueryPartiesDto, { active: 'true' }).active).toBe(true);
    expect(parse(QueryPartiesDto, { active: 'false' }).active).toBe(false);
  });

  it('clamps the limit at 200 and rejects an unknown role', async () => {
    await expectValid(QueryPartiesDto, { limit: 200, role: PartyRole.SUPPLIER });
    await expectInvalid(QueryPartiesDto, { limit: 201 }, 'limit');
    await expectInvalid(QueryPartiesDto, { role: 'partner' }, 'role');
  });
});
