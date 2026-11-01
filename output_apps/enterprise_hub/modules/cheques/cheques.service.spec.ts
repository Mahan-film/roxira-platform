import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ChequeEventEntity } from './entities/cheque-event.entity';
import { ChequeEntity } from './entities/cheque.entity';
import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import { toMinor } from '../accounting/money';
import { ChequesService } from './services/cheques.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

interface Entry {
  tenantId: string;
  entryNumber: string;
  description: string;
  lines: Array<{ accountCode: string; debit?: number | string; credit?: number | string; partyCode?: string }>;
}

/** In-memory stand-ins that honour tenant scoping and transaction rollback. */
function build() {
  let cheques: ChequeEntity[] = [];
  let events: ChequeEventEntity[] = [];
  let entries: Entry[] = [];
  let seq = 0;
  const accounts = new Map<string, Set<string>>();
  const failNextPosting = { on: false };

  const repo = {
    async runInTransaction<T>(_tenantId: string, work: (m: unknown) => Promise<T>): Promise<T> {
      const snapshot = [cheques.map((c) => ({ ...c })), events.map((e) => ({ ...e })), [...entries]] as const;
      try {
        return await work({});
      } catch (error) {
        [cheques, events, entries] = [snapshot[0] as ChequeEntity[], snapshot[1] as ChequeEventEntity[], [...snapshot[2]]];
        throw error;
      }
    },
    async create(tenantId: string, input: Partial<ChequeEntity>) {
      const row = { ...input, id: ++seq, tenantId, status: ChequeStatus.REGISTERED, spentToName: null } as ChequeEntity;
      cheques.push(row);
      return row;
    },
    async findById(tenantId: string, id: number) {
      return cheques.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
    },
    async findByIdForUpdate(tenantId: string, id: number) {
      return cheques.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
    },
    async findBySayadNumber(tenantId: string, sayad: string) {
      return cheques.find((c) => c.sayadNumber === sayad && c.tenantId === tenantId) ?? null;
    },
    async list(tenantId: string) {
      return cheques.filter((c) => c.tenantId === tenantId);
    },
    async listOpenDueBy(tenantId: string, statuses: ChequeStatus[], dueTo: string) {
      return cheques
        .filter((c) => c.tenantId === tenantId && statuses.includes(c.status) && c.dueDate <= dueTo)
        .sort((x, y) => x.dueDate.localeCompare(y.dueDate));
    },
    async updateStatus(tenantId: string, id: number, patch: Partial<ChequeEntity>) {
      Object.assign(cheques.find((c) => c.id === id && c.tenantId === tenantId)!, patch);
    },
    async addEvent(tenantId: string, input: Partial<ChequeEventEntity>) {
      const row = { ...input, id: events.length + 1, tenantId } as ChequeEventEntity;
      events.push(row);
      return row;
    },
    async listEvents(tenantId: string, chequeId: number) {
      return events.filter((e) => e.tenantId === tenantId && e.chequeId === chequeId);
    },
  };

  const accounting = {
    async listAccounts(tenantId: string) {
      return ['1010', '1020', '2010', ...(accounts.get(tenantId) ?? [])].map((code) => ({ code }));
    },
    async createAccount(tenantId: string, dto: { code: string }) {
      accounts.set(tenantId, (accounts.get(tenantId) ?? new Set()).add(dto.code));
    },
    async createJournalEntry(tenantId: string, dto: Entry) {
      if (failNextPosting.on) {
        failNextPosting.on = false;
        throw new BadRequestException('period locked');
      }
      const debit = dto.lines.reduce((s, l) => s + toMinor(l.debit ?? 0), 0n);
      const credit = dto.lines.reduce((s, l) => s + toMinor(l.credit ?? 0), 0n);
      if (debit !== credit) throw new Error('unbalanced');
      entries.push({ ...dto, tenantId });
      return { id: entries.length };
    },
  };

  const service = new ChequesService(repo as never, accounting as never);
  return {
    service,
    failNextPosting,
    accounts,
    resetChart() {
      accounts.clear();
    },
    get entries() {
      return entries;
    },
    get events() {
      return events;
    },
  };
}

const received = (over: Record<string, unknown> = {}) => ({
  direction: ChequeDirection.RECEIVED,
  sayadNumber: '1234567890123456',
  chequeNumber: '555001',
  amount: 50_000_000,
  issueDate: '2026-10-01',
  dueDate: '2026-12-01',
  partyName: 'مشتری نمونه',
  partyCode: 'C-1',
  ...over,
});

const shape = (entry: Entry) => entry.lines.map((l) => `${toMinor(l.debit ?? 0) > 0n ? 'Dr' : 'Cr'}${l.accountCode}`);

describe('ChequesService lifecycle and ledger', () => {
  it('creates the cheque accounts per tenant on first use', async () => {
    const t = build();
    await t.service.create(A, received() as never);
    expect([...(t.accounts.get(A) ?? [])].sort()).toEqual(['1110', '1120', '2110']);
    expect(t.accounts.get(B)).toBeUndefined();
  });

  it('received: register -> deposit -> clear posts one balanced entry per step and records events', async () => {
    const t = build();
    const created = await t.service.create(A, received() as never);
    expect(created.status).toBe('registered');
    expect(shape(t.entries[0])).toEqual(['Dr1110', 'Cr1020']);
    expect(t.entries[0].lines[1].partyCode).toBe('C-1');

    await t.service.transition(A, created.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-11-25' });
    const done = await t.service.transition(A, created.id, { status: ChequeStatus.CLEARED, eventDate: '2026-12-01' });

    expect(t.entries.map(shape)).toEqual([
      ['Dr1110', 'Cr1020'],
      ['Dr1120', 'Cr1110'],
      ['Dr1010', 'Cr1120'],
    ]);
    expect(done.status).toBe('cleared');
    expect(done.allowedNext).toEqual([]);
    expect(done.events.map((e) => e.toStatus)).toEqual(['registered', 'deposited', 'cleared']);
    expect(done.events.every((e) => e.journalEntryId !== null)).toBe(true);
  });

  it('received: bounce restores the receivable, and a re-deposit moves it back to collection', async () => {
    const t = build();
    const { id } = await t.service.create(A, received() as never);
    await t.service.transition(A, id, { status: ChequeStatus.DEPOSITED });
    await t.service.transition(A, id, { status: ChequeStatus.BOUNCED });
    await t.service.transition(A, id, { status: ChequeStatus.DEPOSITED });
    expect(t.entries.map(shape).slice(2)).toEqual([['Dr1020', 'Cr1120'], ['Dr1120', 'Cr1020']]);
  });

  it('received: endorsing needs a third-party name and settles the supplier payable', async () => {
    const t = build();
    const { id } = await t.service.create(A, received() as never);
    await expect(t.service.transition(A, id, { status: ChequeStatus.SPENT })).rejects.toBeInstanceOf(BadRequestException);
    const spent = await t.service.transition(A, id, { status: ChequeStatus.SPENT, spentToName: 'تأمین‌کننده' });
    expect(spent.spentToName).toBe('تأمین‌کننده');
    expect(shape(t.entries[1])).toEqual(['Dr2010', 'Cr1110']);
    expect(t.entries[1].lines.every((l) => l.partyCode === undefined)).toBe(true);
  });

  it('issued: register -> clear, and bounce is status-only', async () => {
    const t = build();
    const a = await t.service.create(A, received({ direction: ChequeDirection.ISSUED, sayadNumber: undefined }) as never);
    expect(shape(t.entries[0])).toEqual(['Dr2010', 'Cr2110']);
    await t.service.transition(A, a.id, { status: ChequeStatus.BOUNCED });
    expect(t.entries).toHaveLength(1);
    await t.service.transition(A, a.id, { status: ChequeStatus.CLEARED });
    expect(shape(t.entries[1])).toEqual(['Dr2110', 'Cr1010']);
    expect(t.events.map((e) => e.journalEntryId)).toEqual([1, null, 2]);
  });

  it('rejects illegal and post-terminal moves without posting anything', async () => {
    const t = build();
    const issued = await t.service.create(A, received({ direction: ChequeDirection.ISSUED, sayadNumber: undefined }) as never);
    await expect(t.service.transition(A, issued.id, { status: ChequeStatus.DEPOSITED })).rejects.toBeInstanceOf(BadRequestException);
    const { id } = await t.service.create(A, received() as never);
    await t.service.transition(A, id, { status: ChequeStatus.RETURNED });
    await expect(t.service.transition(A, id, { status: ChequeStatus.DEPOSITED })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.entries).toHaveLength(3); // two creations + one return, nothing for the rejected moves
  });

  it('rolls the status back when the ledger posting fails', async () => {
    const t = build();
    const { id } = await t.service.create(A, received() as never);
    t.failNextPosting.on = true;
    await expect(t.service.transition(A, id, { status: ChequeStatus.DEPOSITED })).rejects.toThrow('period locked');
    const after = await t.service.get(A, id);
    expect(after.status).toBe('registered');
    expect(after.events).toHaveLength(1);
  });

  it('validates dates', async () => {
    const t = build();
    await expect(t.service.create(A, received({ dueDate: '2026-09-01' }) as never)).rejects.toBeInstanceOf(BadRequestException);
    const { id } = await t.service.create(A, received() as never);
    await expect(
      t.service.transition(A, id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChequesService tenant isolation', () => {
  it("tenant B cannot read, list or move tenant A's cheque", async () => {
    const t = build();
    const { id } = await t.service.create(A, received() as never);
    await expect(t.service.get(B, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.service.transition(B, id, { status: ChequeStatus.DEPOSITED })).rejects.toBeInstanceOf(NotFoundException);
    expect(await t.service.list(B, {})).toEqual([]);
    expect((await t.service.listDue(B, { asOf: '2026-12-01' })).items).toEqual([]);
    expect(t.entries).toHaveLength(1);
    expect((await t.service.get(A, id)).status).toBe('registered');
  });

  it('the same Sayad number is unique within a tenant but reusable across tenants', async () => {
    const t = build();
    await t.service.create(A, received() as never);
    await expect(t.service.create(A, received({ chequeNumber: '2' }) as never)).rejects.toBeInstanceOf(ConflictException);
    await expect(t.service.create(B, received() as never)).resolves.toMatchObject({ status: 'registered' });
  });

  it('postings carry the owning tenant', async () => {
    const t = build();
    await t.service.create(A, received() as never);
    await t.service.create(B, received({ sayadNumber: undefined }) as never);
    expect(t.entries.map((e) => e.tenantId)).toEqual([A, B]);
  });
});

describe('ChequesService money and chart', () => {
  it('keeps amounts up to numeric(18,2) exact end to end', async () => {
    const t = build();
    const created = await t.service.create(A, received({ amount: '9999999999999999.99' }) as never);
    expect(created.amount).toBe('9999999999999999.99');
    expect(t.entries[0].lines.map((l) => [l.debit, l.credit])).toEqual([
      ['9999999999999999.99', '0.00'],
      ['0.00', '9999999999999999.99'],
    ]);
    const done = await t.service.transition(A, created.id, { status: ChequeStatus.DEPOSITED });
    expect(done.amount).toBe('9999999999999999.99');
    const due = await t.service.listDue(A, { asOf: '2026-12-01' });
    expect(due.receivedTotal).toBe('9999999999999999.99');
  });

  it('rejects zero, inexact and over-long amounts', async () => {
    const t = build();
    await expect(t.service.create(A, received({ amount: 0 }) as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.create(A, received({ amount: '10.005' }) as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.create(A, received({ amount: '99999999999999999' }) as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.entries).toHaveLength(0);
  });

  it('received: a cheque presented at the counter clears or bounces straight from registered', async () => {
    const t = build();
    const a = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    const b = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    await t.service.transition(A, a.id, { status: ChequeStatus.CLEARED });
    await t.service.transition(A, b.id, { status: ChequeStatus.BOUNCED });
    expect(t.entries.map(shape).slice(2)).toEqual([['Dr1010', 'Cr1110'], ['Dr1020', 'Cr1110']]);
  });

  it('recreates the cheque accounts after a chart reset', async () => {
    const t = build();
    await t.service.create(A, received({ sayadNumber: undefined }) as never);
    t.resetChart();
    await t.service.create(A, received({ sayadNumber: undefined }) as never);
    expect([...(t.accounts.get(A) ?? [])].sort()).toEqual(['1110', '1120', '2110']);
  });
});

describe('ChequesService due list', () => {
  it('keeps bounced cheques visible and overdue until they are cleared or returned', async () => {
    const t = build();
    const { id } = await t.service.create(A, received({ sayadNumber: undefined, dueDate: '2026-10-15', amount: 40 }) as never);
    await t.service.transition(A, id, { status: ChequeStatus.DEPOSITED });
    await t.service.transition(A, id, { status: ChequeStatus.BOUNCED });
    let due = await t.service.listDue(A, { asOf: '2026-11-01', days: 30 });
    expect(due.items).toHaveLength(1);
    expect(due.items[0]).toMatchObject({ id, status: 'bounced', overdue: true });
    expect(due.receivedTotal).toBe(40);
    await t.service.transition(A, id, { status: ChequeStatus.RETURNED });
    due = await t.service.listDue(A, { asOf: '2026-11-01', days: 30 });
    expect(due.items).toHaveLength(0);
  });

  it('lists open cheques due in the window plus overdue, sorted, with totals', async () => {
    const t = build();
    const overdue = await t.service.create(A, received({ sayadNumber: undefined, dueDate: '2026-10-20', amount: 10 }) as never);
    await t.service.create(A, received({ sayadNumber: undefined, dueDate: '2026-11-10', amount: 20 }) as never);
    await t.service.create(A, received({ sayadNumber: undefined, dueDate: '2027-03-01', amount: 30 }) as never);
    await t.service.create(A, received({ sayadNumber: undefined, direction: ChequeDirection.ISSUED, dueDate: '2026-11-05', amount: 5 }) as never);
    const done = await t.service.create(A, received({ sayadNumber: undefined, dueDate: '2026-11-01', amount: 99 }) as never);
    await t.service.transition(A, done.id, { status: ChequeStatus.RETURNED });

    const due = await t.service.listDue(A, { asOf: '2026-11-01', days: 30 });
    expect(due.until).toBe('2026-12-01');
    expect(due.items.map((i) => i.dueDate)).toEqual(['2026-10-20', '2026-11-05', '2026-11-10']);
    expect(due.items[0]).toMatchObject({ id: overdue.id, overdue: true, daysUntilDue: -12 });
    expect(due.items[2]).toMatchObject({ overdue: false, daysUntilDue: 9 });
    expect(due.receivedTotal).toBe(30);
    expect(due.issuedTotal).toBe(5);
  });
});
