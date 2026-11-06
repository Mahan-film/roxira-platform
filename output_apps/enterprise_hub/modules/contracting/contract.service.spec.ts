import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PartyRole } from '../parties/enums/party-role.enum';
import { ContractSide, ContractStatus } from './enums/contracting.enum';
import { canTransition, ContractService, partyFitsSide } from './services/contract.service';

const T = '11111111-1111-4111-8111-111111111111';

function build(role: PartyRole | null, existingCode = false) {
  const created: any[] = [];
  const repository: any = {
    findByCode: jest.fn(async () => (existingCode ? { id: 1 } : null)),
    create: jest.fn(async (_t: string, input: any) => {
      const row = { id: 7, status: 'draft', createdAt: new Date(), updatedAt: new Date(), ...input };
      created.push(row);
      return row;
    }),
  };
  const projects: any = { findById: jest.fn(async () => null) };
  const parties: any = {
    getByCode: jest.fn(async (_t: string, code: string) => {
      if (!role) throw new NotFoundException('x');
      return { code, role };
    }),
  };
  return { service: new ContractService(repository, projects, parties), created };
}

const dto = (over: Record<string, unknown> = {}) =>
  ({ code: ' K1 ', title: 'قرارداد', side: ContractSide.EMPLOYER, partyCode: 'S1', contractDate: '2026-11-01', amount: '1234567.89', ...over }) as never;

describe('contract status', () => {
  it('moves draft -> active -> closed and never back', () => {
    expect(canTransition(ContractStatus.DRAFT, ContractStatus.ACTIVE)).toBe(true);
    expect(canTransition(ContractStatus.DRAFT, ContractStatus.CLOSED)).toBe(true);
    expect(canTransition(ContractStatus.ACTIVE, ContractStatus.CLOSED)).toBe(true);
    expect(canTransition(ContractStatus.ACTIVE, ContractStatus.DRAFT)).toBe(false);
    expect(canTransition(ContractStatus.CLOSED, ContractStatus.ACTIVE)).toBe(false);
    expect(canTransition(ContractStatus.ACTIVE, ContractStatus.ACTIVE)).toBe(false);
  });
});

describe('party role against contract side', () => {
  it('employer side needs a supplier or both, contractor side a customer or both', () => {
    expect(partyFitsSide(ContractSide.EMPLOYER, PartyRole.CUSTOMER)).toBe(false);
    expect(partyFitsSide(ContractSide.EMPLOYER, PartyRole.SUPPLIER)).toBe(true);
    expect(partyFitsSide(ContractSide.EMPLOYER, PartyRole.BOTH)).toBe(true);
    expect(partyFitsSide(ContractSide.CONTRACTOR, PartyRole.CUSTOMER)).toBe(true);
    expect(partyFitsSide(ContractSide.CONTRACTOR, PartyRole.SUPPLIER)).toBe(false);
  });
});

describe('ContractService.create', () => {
  it('refuses an employer contract with a customer-only party', async () => {
    const { service } = build(PartyRole.CUSTOMER);
    await expect(service.create(T, dto())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a contractor contract with a customer and stores the exact money string', async () => {
    const { service, created } = build(PartyRole.CUSTOMER);
    const out = await service.create(T, dto({ side: ContractSide.CONTRACTOR }));
    expect(created[0]).toMatchObject({ code: 'K1', amount: '1234567.89', advanceAmount: '0.00' });
    expect(out.amount).toBe(1234567.89);
  });

  it('refuses an unknown party, an advance above the amount, and a duplicate code', async () => {
    await expect(build(null).service.create(T, dto())).rejects.toThrow('طرف حساب یافت نشد');
    await expect(build(PartyRole.BOTH).service.create(T, dto({ amount: '500.00', advanceAmount: '600.00' }))).rejects.toThrow('پیش‌پرداخت');
    await expect(build(PartyRole.BOTH, true).service.create(T, dto())).rejects.toBeInstanceOf(ConflictException);
  });
});
