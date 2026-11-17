import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditRepository, auditRowHash, GENESIS_HASH, sanitizeChainMetadata } from '../access/repositories/audit.repository';
import { AuditService } from '../access/services/audit.service';
import { PartyRole } from './enums/party-role.enum';
import { decryptPartyPii, encryptPartyPii, ERASED_PARTY_NAME, generatePartyDek } from './services/party-crypto';
import { PartiesService, toPartyResponse } from './services/parties.service';

const T = '11111111-1111-4111-8111-111111111111';

function build(existing: Record<string, unknown> = {}) {
  const created: any[] = [];
  const repository: any = {
    list: jest.fn(async () => ({ rows: [], total: 0 })),
    findByCode: jest.fn(async (_t: string, code: string) => (code in existing ? { id: 9, code, name: 'قدیمی', role: 'customer', active: true } : null)),
    findById: jest.fn(async () => (existing['byId'] ? { id: 5, code: 'C5', name: 'قدیمی', role: 'customer', active: true } : null)),
    create: jest.fn(async (_t: string, input: any) => { const d = { id: 1, active: true, ...input }; created.push(d); return d; }),
    update: jest.fn(async (_t: string, id: number, patch: any) => ({ id, code: 'C5', ...patch })),
    findExistingCodes: jest.fn(async () => []),
    insertMany: jest.fn(async () => []),
    deleteByIds: jest.fn(async () => 0),
  };
  const service = new PartiesService(repository);
  return { service, repository, created };
}

describe('PartiesService.create', () => {
  it('trims code and name before insert', async () => {
    const { service, created } = build();
    await service.create(T, { code: ' C1 ', name: ' مشتری الف ', role: PartyRole.CUSTOMER } as never);
    expect(created[0]).toMatchObject({ code: 'C1', name: 'مشتری الف', active: true });
  });

  it('refuses a duplicate code with a Persian conflict message', async () => {
    const { service } = build({ C1: true });
    await expect(service.create(T, { code: 'C1', name: 'x', role: PartyRole.CUSTOMER } as never)).rejects.toThrow('کد طرف حساب تکراری است.');
  });

  it('parses creditLimit to minor units on create or throws BadRequestException on invalid format', async () => {
    const { service, created } = build();
    await service.create(T, { code: 'C2', name: 'مشتری ب', role: PartyRole.CUSTOMER, creditLimit: '1000' } as never);
    expect(created[0]).toMatchObject({ creditLimit: '100000' });

    await expect(
      service.create(T, { code: 'C3', name: 'مشتری ج', role: PartyRole.CUSTOMER, creditLimit: 'invalid-money' } as never),
    ).rejects.toThrow('سقف اعتبار نامعتبر است.');
  });
});

describe('PartiesService.getByCode', () => {
  it('throws NotFound with the Persian message when the code is unknown', async () => {
    const { service } = build();
    await expect(service.getByCode(T, 'NOPE')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getByCode(T, 'NOPE')).rejects.toThrow('طرف حساب یافت نشد.');
  });
});

describe('PartiesService.update', () => {
  it('throws NotFound when the party does not exist in this tenant', async () => {
    const { service } = build();
    await expect(service.update(T, 123, { name: 'x' } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });

  it('passes the patch through and returns the updated row', async () => {
    const { service, repository } = build({ byId: true });
    const updated = await service.update(T, 5, { name: ' نو ', role: PartyRole.BOTH, active: false } as never);
    expect(repository.update.mock.calls[0]).toEqual([T, 5, { name: 'نو', role: PartyRole.BOTH, active: false }]);
    expect(updated).toMatchObject({ id: 5, name: 'نو', role: PartyRole.BOTH, active: false });
  });
});

describe('T206 crypto-shredding & hash-chain verification after erasure', () => {
  it('encrypts party PII with a per-party DEK and renders it undecryptable once the key is destroyed', () => {
    const dek = generatePartyDek();
    const ct = encryptPartyPii(dek, {
      name: 'علی رضایی',
      nationalId: '0012345678',
      economicCode: null,
      phone: '09120000000',
      email: 'ali@example.com',
    });
    expect(decryptPartyPii(dek, ct)).toEqual({
      name: 'علی رضایی',
      nationalId: '0012345678',
      economicCode: null,
      phone: '09120000000',
      email: 'ali@example.com',
    });
    // Destroy the key -> crypto-shredded
    expect(decryptPartyPii(null, ct)).toBeNull();
    expect(decryptPartyPii(generatePartyDek(), ct)).toBeNull();
  });

  it('strips names and IBANs from hash-chained metadata and keeps the chain verifiable after party erasure', async () => {
    const dek = generatePartyDek();
    const piiCiphertext = encryptPartyPii(dek, {
      name: 'شرکت آزمایشی',
      nationalId: '1234567890',
      economicCode: null,
      phone: null,
      email: null,
    });
    let partyErasedAt: Date | null = null;
    let storedDek: string | null = dek;

    const chainRows: Array<{
      id: string;
      tenantId: string | null;
      actorUserId: string | null;
      action: string;
      resourceType: string | null;
      resourceId: string | null;
      metadata: unknown;
      ip: string | null;
      userAgent: string | null;
      createdAt: Date;
      prevHash: string | null;
      hash: string | null;
    }> = [];

    const appendRow = (entry: {
      tenantId: string | null;
      actorUserId: string | null;
      action: string;
      resourceType?: string | null;
      resourceId?: string | null;
      metadata?: unknown;
    }) => {
      const createdAt = new Date(1700000000000 + chainRows.length * 1000);
      const prev = chainRows.length > 0 ? (chainRows[chainRows.length - 1].hash as string) : GENESIS_HASH;
      const cleanMeta = entry.metadata ? sanitizeChainMetadata(entry.metadata) : null;
      const row = {
        id: String(chainRows.length + 1),
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        metadata: cleanMeta,
        ip: null,
        userAgent: null,
        createdAt,
        prevHash: prev,
        hash: '',
      };
      row.hash = auditRowHash(prev, row);
      chainRows.push(row);
    };

    const audit = new AuditService({
      append: jest.fn(async (data: any) => appendRow(data)),
    } as unknown as AuditRepository);

    const repo: any = {
      erasePersonalData: jest.fn(async (_t: string, id: number) => {
        if (id !== 42) return false;
        storedDek = null;
        partyErasedAt = new Date();
        return true;
      }),
    };
    const service = new PartiesService(repo, audit);

    // 1. Record an event that accidentally passes PII keys: sanitizer must strip them.
    await audit.record({
      tenantId: T,
      actorUserId: null,
      action: 'party.referenced',
      resourceType: 'party',
      resourceId: '42',
      metadata: { partyId: 42, partyName: 'شرکت آزمایشی', iban: 'IR000000000000001234567890', username: 'ali' },
    });
    expect(chainRows[0].metadata).toEqual({ partyId: 42 });

    // 2. Crypto-shred party 42.
    await expect(service.erasePersonalData(T, 999)).rejects.toBeInstanceOf(NotFoundException);
    const res = await service.erasePersonalData(T, 42);
    expect(res).toEqual({ partyId: 42, erased: true });
    expect(storedDek).toBeNull();
    expect(decryptPartyPii(storedDek, piiCiphertext)).toBeNull();
    expect(
      toPartyResponse({
        id: 42,
        tenantId: T,
        code: 'P42',
        name: ERASED_PARTY_NAME,
        role: PartyRole.CUSTOMER,
        nationalId: null,
        economicCode: null,
        phone: null,
        email: null,
        active: false,
        creditLimit: '0',
        erasedAt: partyErasedAt,
      } as any),
    ).toMatchObject({ id: 42, name: ERASED_PARTY_NAME, nationalId: null, phone: null, email: null, active: false });

    // 3. Verify the entire hash chain still passes after erasure.
    let prev = GENESIS_HASH;
    for (const r of chainRows) {
      expect(r.prevHash).toBe(prev);
      expect(r.hash).toBe(auditRowHash(prev, r));
      prev = r.hash!;
    }
    expect(chainRows).toHaveLength(2);
    expect(chainRows[1].action).toBe('party.erased');
    expect(chainRows[1].metadata).toEqual({ partyId: 42 });
  });
});
