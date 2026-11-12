import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ChequeEventEntity } from './entities/cheque-event.entity';
import { ChequeEntity } from './entities/cheque.entity';
import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import { toMinor } from '../accounting/money';
import { ChequesService } from './services/cheques.service';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';

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
  /** Manager each `listEvents` read was run with (undefined = a separate TenantScope connection). */
  const eventReadManagers: unknown[] = [];

  const repo = {
    async runInTransaction<T>(_tenantId: string, work: (m: unknown) => Promise<T>): Promise<T> {
      const snapshot = [cheques.map((c) => ({ ...c })), events.map((e) => ({ ...e })), [...entries]] as const;
      const sourcesSnapshot = new Map(sources);
      try {
        return await work({});
      } catch (error) {
        [cheques, events, entries] = [snapshot[0] as ChequeEntity[], snapshot[1] as ChequeEventEntity[], [...snapshot[2]]];
        sources = sourcesSnapshot;
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
    async listByStatus(tenantId: string, status: ChequeStatus) {
      return cheques.filter((c) => c.tenantId === tenantId && c.status === status);
    },
    async listEventsToStatus(tenantId: string, ids: number[], toStatus: ChequeStatus) {
      return events
        .filter((e) => e.tenantId === tenantId && ids.includes(e.chequeId) && e.toStatus === toStatus)
        .sort((x, y) => y.eventDate.localeCompare(x.eventDate) || y.id - x.id);
    },
    async updateStatus(tenantId: string, id: number, patch: Partial<ChequeEntity>) {
      Object.assign(cheques.find((c) => c.id === id && c.tenantId === tenantId)!, patch);
    },
    async addEvent(tenantId: string, input: Partial<ChequeEventEntity>) {
      const row = { ...input, id: events.length + 1, tenantId } as ChequeEventEntity;
      events.push(row);
      return row;
    },
    async listEvents(tenantId: string, chequeId: number, manager?: unknown) {
      eventReadManagers.push(manager);
      return events.filter((e) => e.tenantId === tenantId && e.chequeId === chequeId);
    },
  };

  const accounting = {
    async listAccounts(tenantId: string) {
      return ['1010', '1020', '2010', '1099', ...(accounts.get(tenantId) ?? [])].map((code) => ({ code }));
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

  // the real engine over an in-memory source ledger (rolled back with the cheque transaction)
  let sources = new Map<string, { entryId: number | null; entryNumber: string | null }>();
  const postingRepo = {
    async runInTransaction<T>(_t: string, work: (m: unknown) => Promise<T>) {
      return work({});
    },
    async listMappings() {
      return [];
    },
    async findSource(_t: string, st: string, sid: string, dt: string) {
      return sources.get(`${st}/${sid}/${dt}`) ?? null;
    },
    async claimSource(_t: string, st: string, sid: string, dt: string) {
      if (sources.has(`${st}/${sid}/${dt}`)) return false;
      sources.set(`${st}/${sid}/${dt}`, { entryId: null, entryNumber: null });
      return true;
    },
    async attachEntry(_t: string, st: string, sid: string, dt: string, entryId: number, entryNumber: string) {
      Object.assign(sources.get(`${st}/${sid}/${dt}`)!, { entryId, entryNumber });
    },
  };
  const banking = {
    async listAccounts(tenantId: string) {
      return tenantId === A ? [{ id: 7, ledgerAccountCode: '1099' }] : [];
    },
  };
  const service = new ChequesService(
    repo as never,
    accounting as never,
    new PostingRulesService(postingRepo as never, accounting as never),
    banking as never,
  );
  return {
    service,
    failNextPosting,
    accounts,
    eventReadManagers,
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

const issued = (over: Record<string, unknown> = {}) => received({ direction: ChequeDirection.ISSUED, sayadNumber: undefined, ...over });

describe('ChequesService issued lifecycle (CHK-01)', () => {
  it('issued: register -> deliver (no posting) -> clear', async () => {
    const t = build();
    const c = await t.service.create(A, issued() as never);
    const delivered = await t.service.transition(A, c.id, { status: ChequeStatus.DELIVERED, eventDate: '2026-10-05' });
    expect(delivered.status).toBe('delivered');
    expect(delivered.allowedNext).toEqual(['cleared', 'bounced', 'returned']);
    expect(t.entries).toHaveLength(1);
    const done = await t.service.transition(A, c.id, { status: ChequeStatus.CLEARED });
    expect(shape(t.entries[1])).toEqual(['Dr2110', 'Cr1010']);
    expect(done.events.map((e) => e.toStatus)).toEqual(['registered', 'delivered', 'cleared']);
  });

  it('issued: delivered -> bounced is status only, then cleared later posts the payment', async () => {
    const t = build();
    const c = await t.service.create(A, issued() as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DELIVERED });
    await t.service.transition(A, c.id, { status: ChequeStatus.BOUNCED });
    expect(t.entries).toHaveLength(1);
    await t.service.transition(A, c.id, { status: ChequeStatus.CLEARED });
    expect(shape(t.entries[1])).toEqual(['Dr2110', 'Cr1010']);
  });

  it('issued: delivered -> returned cancels the note payable back to the payable', async () => {
    const t = build();
    const c = await t.service.create(A, issued() as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DELIVERED });
    await t.service.transition(A, c.id, { status: ChequeStatus.RETURNED });
    expect(shape(t.entries[1])).toEqual(['Dr2110', 'Cr2010']);
  });

  it('received cheques cannot be delivered; issued cannot go back to registered', async () => {
    const t = build();
    const r = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    await expect(t.service.transition(A, r.id, { status: ChequeStatus.DELIVERED })).rejects.toBeInstanceOf(BadRequestException);
    const i = await t.service.create(A, issued() as never);
    await t.service.transition(A, i.id, { status: ChequeStatus.DELIVERED });
    await expect(t.service.transition(A, i.id, { status: ChequeStatus.REGISTERED })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a delivered cheque stays in the due list until it is closed', async () => {
    const t = build();
    const c = await t.service.create(A, issued({ dueDate: '2026-11-05', amount: 7 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DELIVERED });
    const due = await t.service.listDue(A, { asOf: '2026-11-01', days: 30 });
    expect(due.items.map((i) => i.status)).toEqual(['delivered']);
    expect(due.issuedTotal).toBe(7);
  });
});

describe('ChequesService received lifecycle: returned and endorsement (CHK-01)', () => {
  it('received: deposit -> bounce -> return leaves the receivable restored and posts nothing for the return', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    await t.service.transition(A, c.id, { status: ChequeStatus.BOUNCED });
    const done = await t.service.transition(A, c.id, { status: ChequeStatus.RETURNED });
    expect(t.entries).toHaveLength(3);
    expect(done.events.map((e) => e.journalEntryId)).toEqual([1, 2, 3, null]);
    expect(done.events.at(-1)!.amount).toBeNull();
  });

  it('endorsement stores the third party and posts the payable against that party code', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    const spent = await t.service.transition(A, c.id, {
      status: ChequeStatus.SPENT,
      spentToName: 'تأمین‌کننده',
      spentToCode: 'S-9',
      spentToNationalId: '0499370899',
    });
    expect(spent).toMatchObject({ spentToName: 'تأمین‌کننده', spentToCode: 'S-9', spentToNationalId: '0499370899' });
    expect(t.entries[1].lines.find((l) => l.accountCode === '2010')!.partyCode).toBe('S-9');
  });

  it('endorsement rejects an invalid national id and leaves the cheque untouched', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    await expect(
      t.service.transition(A, c.id, { status: ChequeStatus.SPENT, spentToName: 'x', spentToNationalId: '0499370890' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await t.service.get(A, c.id)).status).toBe('registered');
    expect(t.entries).toHaveLength(1);
  });

  it('an endorsed cheque is final and cannot be endorsed again', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.SPENT, spentToName: 'x' });
    await expect(t.service.transition(A, c.id, { status: ChequeStatus.SPENT, spentToName: 'y' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChequesService partial payment (CHK-01)', () => {
  it('received: partial clearing from deposited posts the part and keeps the cheque collectible', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    const after = await t.service.partialPayment(A, c.id, { amount: 30 });
    expect(after).toMatchObject({ status: 'deposited', settledAmount: 30, remainingAmount: 70 });
    expect(shape(t.entries[2])).toEqual(['Dr1010', 'Cr1120']);
    expect(t.entries[2].lines[0].debit).toBe('30.00');
    expect(after.events.at(-1)).toMatchObject({ fromStatus: 'deposited', toStatus: 'deposited', amount: 30 });
  });

  it('the closing clear posts only the remainder and the books add up to the face value', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    await t.service.partialPayment(A, c.id, { amount: 30 });
    const done = await t.service.transition(A, c.id, { status: ChequeStatus.CLEARED });
    expect(t.entries[3].lines[0].debit).toBe('70.00');
    expect(done).toMatchObject({ status: 'cleared', settledAmount: 100, remainingAmount: 0 });
    const toBank = t.entries.flatMap((e) => e.lines).filter((l) => l.accountCode === '1010').reduce((s, l) => s + toMinor(l.debit ?? 0), 0n);
    expect(toBank).toBe(toMinor(100));
  });

  it('received: bouncing after a partial payment restores only the unpaid remainder', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    await t.service.partialPayment(A, c.id, { amount: 40 });
    await t.service.transition(A, c.id, { status: ChequeStatus.BOUNCED });
    expect(shape(t.entries[3])).toEqual(['Dr1020', 'Cr1120']);
    expect(t.entries[3].lines[0].debit).toBe('60.00');
    // the bounced remainder shows in the due list at 60, not 100
    expect((await t.service.listDue(A, { asOf: '2026-12-10' })).receivedTotal).toBe(60);
  });

  it('issued: partial payment from delivered posts Dr 2110 / Cr 1010 for the part', async () => {
    const t = build();
    const c = await t.service.create(A, issued({ amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DELIVERED });
    await t.service.partialPayment(A, c.id, { amount: '25.50' });
    expect(shape(t.entries[1])).toEqual(['Dr2110', 'Cr1010']);
    expect(t.entries[1].lines[0].debit).toBe('25.50');
    expect((await t.service.get(A, c.id)).remainingAmount).toBe(74.5);
  });

  it('a cheque with a payment taken cannot be endorsed', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.partialPayment(A, c.id, { amount: 10 }); // counter payment from registered
    await expect(t.service.transition(A, c.id, { status: ChequeStatus.SPENT, spentToName: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([[0], [100], [150], ['0.00']])('rejects an invalid partial amount %s', async (amount) => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await expect(t.service.partialPayment(A, c.id, { amount })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.entries).toHaveLength(1);
  });

  it('rejects a second partial payment that would take the whole remainder', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.partialPayment(A, c.id, { amount: 60 });
    await expect(t.service.partialPayment(A, c.id, { amount: 40 })).rejects.toBeInstanceOf(BadRequestException);
    await t.service.partialPayment(A, c.id, { amount: 39 });
    expect((await t.service.get(A, c.id)).remainingAmount).toBe(1);
  });

  it('is refused from closed states and rolls back when the posting fails', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    t.failNextPosting.on = true;
    await expect(t.service.partialPayment(A, c.id, { amount: 10 })).rejects.toThrow('period locked');
    expect((await t.service.get(A, c.id)).settledAmount).toBe(0);
    await t.service.transition(A, c.id, { status: ChequeStatus.RETURNED });
    await expect(t.service.partialPayment(A, c.id, { amount: 10 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("tenant B cannot pay part of tenant A's cheque", async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    await expect(t.service.partialPayment(B, c.id, { amount: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a retried payment with the same idempotency key posts and settles once', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    const first = await t.service.partialPayment(A, c.id, { amount: 30, idempotencyKey: 'pay-1' });
    const retry = await t.service.partialPayment(A, c.id, { amount: 30, idempotencyKey: 'pay-1' });
    expect(first).toMatchObject({ settledAmount: 30, remainingAmount: 70 });
    expect(retry).toMatchObject({ settledAmount: 30, remainingAmount: 70 });
    expect(t.entries).toHaveLength(2); // creation + the one real partial payment
    expect(t.events).toHaveLength(2);
  });

  it('a replayed payment is not refused by the remainder it already shrank', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.partialPayment(A, c.id, { amount: 80, idempotencyKey: 'pay-2' });
    const retry = await t.service.partialPayment(A, c.id, { amount: 80, idempotencyKey: 'pay-2' });
    expect(retry).toMatchObject({ settledAmount: 80, remainingAmount: 20 });
    expect(t.entries).toHaveLength(2);
  });

  it('a different idempotency key is a new partial payment', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.partialPayment(A, c.id, { amount: 30, idempotencyKey: 'pay-a' });
    const second = await t.service.partialPayment(A, c.id, { amount: 20, idempotencyKey: 'pay-b' });
    expect(second).toMatchObject({ settledAmount: 50, remainingAmount: 50 });
    expect(t.entries).toHaveLength(3);
  });

  it('numeric idempotency key does not collide with later event seq sourceId', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    // Event count is now 2 (create, transition). A partial payment with numeric idempotencyKey '2'
    // is scoped as 'idem:2' and must not collide with subsequent event seq=2
    await t.service.partialPayment(A, c.id, { amount: 30, idempotencyKey: '2' });
    const cleared = await t.service.transition(A, c.id, { status: ChequeStatus.CLEARED });
    expect(cleared).toMatchObject({ status: 'cleared', settledAmount: 100, remainingAmount: 0 });
    // Both partial voucher and closing voucher exist with remainder posted
    expect(t.entries.at(-1)?.lines[0].debit).toBe('70.00');
  });

  it('reusing the same idempotency key with a different body throws 409 ConflictException', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.partialPayment(A, c.id, { amount: 30, idempotencyKey: 'pay-conflict' });
    await expect(
      t.service.partialPayment(A, c.id, { amount: 40, idempotencyKey: 'pay-conflict' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.service.partialPayment(A, c.id, { amount: 30, eventDate: '2026-11-20', idempotencyKey: 'pay-conflict' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.service.partialPayment(A, c.id, { amount: 30, bankAccountId: 7, idempotencyKey: 'pay-conflict' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reads the source sequence through the posting transaction, not a second connection', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    t.eventReadManagers.length = 0;
    await t.service.partialPayment(A, c.id, { amount: 30 });
    expect(t.eventReadManagers.some((manager) => manager !== undefined && manager !== null)).toBe(true);
  });
});

describe('ChequesService bank account override (CHK-01 follow-up)', () => {
  it('clearing with a bank account posts the bank line to its ledger account and stores it', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    await t.service.transition(A, c.id, { status: ChequeStatus.CLEARED, bankAccountId: 7 });
    expect(shape(t.entries[2])).toEqual(['Dr1099', 'Cr1120']);
    expect(t.events.at(-1)!.bankAccountId).toBe(7);
  });

  it('clearing without a bank account still posts to 1010', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    await t.service.transition(A, c.id, { status: ChequeStatus.CLEARED });
    expect(shape(t.entries[2])).toEqual(['Dr1010', 'Cr1120']);
    expect(t.events.at(-1)!.bankAccountId).toBeNull();
  });

  it('partial payment with a bank account posts the part to its ledger account', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    await t.service.partialPayment(A, c.id, { amount: 30, bankAccountId: 7 });
    expect(shape(t.entries[2])).toEqual(['Dr1099', 'Cr1120']);
    expect(t.events.at(-1)!.bankAccountId).toBe(7);
  });

  it('rejects an unknown bank account without posting', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    await expect(
      t.service.transition(A, c.id, { status: ChequeStatus.CLEARED, bankAccountId: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.entries).toHaveLength(2);
    expect((await t.service.get(A, c.id)).status).toBe('deposited');
  });
});

describe('ChequesService Sayad fields (CHK-01)', () => {
  it('rejects a malformed or repeated-digit Sayad id and an invalid receiver id', async () => {
    const t = build();
    await expect(t.service.create(A, received({ sayadNumber: '1111111111111111' }) as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.create(A, received({ sayadNumber: '123' }) as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.create(A, received({ receiverNationalId: '0499370890' }) as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.entries).toHaveLength(0);
  });

  it('stores the receiver national id and the declared registration status', async () => {
    const t = build();
    const c = await t.service.create(A, received({ receiverNationalId: '0499370899', sayadRegistrationStatus: 'registered' }) as never);
    expect(c).toMatchObject({ receiverNationalId: '0499370899', sayadRegistrationStatus: 'registered', sayadVerified: false, sayadVerifiedBy: null });
  });

  it('defaults the registration status to unknown', async () => {
    const t = build();
    expect((await t.service.create(A, received() as never)).sayadRegistrationStatus).toBe('unknown');
  });

  it('manual verification records who and when, and an event keeps the history', async () => {
    const t = build();
    const c = await t.service.create(A, received() as never);
    const v = await t.service.verifySayad(A, c.id, 'user-7', { verified: true, sayadRegistrationStatus: 'registered' as never });
    expect(v).toMatchObject({ sayadVerified: true, sayadVerifiedBy: 'user-7', sayadRegistrationStatus: 'registered' });
    expect(new Date(v.sayadVerifiedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(v.events.at(-1)!.note).toContain('user-7');
    expect(t.entries).toHaveLength(1); // verification posts nothing
    const un = await t.service.verifySayad(A, c.id, 'user-8', { verified: false });
    expect(un).toMatchObject({ sayadVerified: false, sayadVerifiedBy: null, sayadVerifiedAt: null });
  });

  it('creating with sayadVerified stores the creating user as the verifier', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadVerified: true }) as never, 'user-3');
    expect(c).toMatchObject({ sayadVerified: true, sayadVerifiedBy: 'user-3' });
    expect(c.sayadVerifiedAt).not.toBeNull();
  });

  it('cannot verify a cheque that has no Sayad id, and tenants are isolated', async () => {
    const t = build();
    const noId = await t.service.create(A, received({ sayadNumber: undefined }) as never);
    await expect(t.service.verifySayad(A, noId.id, 'u', { verified: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.create(A, received({ sayadNumber: undefined, sayadVerified: true }) as never)).rejects.toBeInstanceOf(BadRequestException);
    const c = await t.service.create(A, received() as never);
    await expect(t.service.verifySayad(B, c.id, 'u', { verified: true })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ChequesService bounced report with ageing (CHK-01)', () => {
  const bounce = async (t: ReturnType<typeof build>, over: Record<string, unknown>, date: string, deposit = true) => {
    const c = await t.service.create(A, received({ sayadNumber: undefined, issueDate: '2026-01-01', dueDate: '2026-12-31', ...over }) as never);
    if (deposit && c.direction === 'received') await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED, eventDate: date });
    await t.service.transition(A, c.id, { status: ChequeStatus.BOUNCED, eventDate: date });
    return c;
  };

  it('buckets by days since the latest bounce and totals the unpaid remainder per direction', async () => {
    const t = build();
    await bounce(t, { amount: 10 }, '2026-10-25'); // 7 days
    await bounce(t, { amount: 20 }, '2026-09-20'); // 42 days
    await bounce(t, { amount: 30 }, '2026-08-20'); // 73 days
    await bounce(t, { amount: 40 }, '2026-05-01'); // 184 days
    await bounce(t, { amount: 5, direction: ChequeDirection.ISSUED }, '2026-10-30', false);
    const r = await t.service.bouncedReport(A, { asOf: '2026-11-01' });
    expect(r.items.map((i) => i.bucket)).toEqual(['90+', '61-90', '31-60', '0-30', '0-30']);
    expect(r.items[0]).toMatchObject({ ageDays: 184, bouncedOn: '2026-05-01' });
    expect(r.buckets.map((b) => [b.bucket, b.count, b.receivedTotal, b.issuedTotal])).toEqual([
      ['0-30', 2, 10, 5],
      ['31-60', 1, 20, 0],
      ['61-90', 1, 30, 0],
      ['90+', 1, 40, 0],
    ]);
    expect([r.receivedTotal, r.issuedTotal]).toEqual([100, 5]);
  });

  it('uses the latest bounce when a cheque was re-deposited and bounced again; boundary days fall in the lower bucket', async () => {
    const t = build();
    const c = await bounce(t, { amount: 10 }, '2026-06-01');
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-09-01' });
    await t.service.transition(A, c.id, { status: ChequeStatus.BOUNCED, eventDate: '2026-10-02' });
    const r = await t.service.bouncedReport(A, { asOf: '2026-11-01' });
    expect(r.items[0]).toMatchObject({ bouncedOn: '2026-10-02', ageDays: 30, bucket: '0-30' });
  });

  it('reports only the unpaid remainder of a partly paid cheque and honours the direction filter', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, amount: 100 }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-10-01' });
    await t.service.partialPayment(A, c.id, { amount: 35, eventDate: '2026-10-05' });
    await t.service.transition(A, c.id, { status: ChequeStatus.BOUNCED, eventDate: '2026-10-10' });
    await bounce(t, { amount: 7, direction: ChequeDirection.ISSUED }, '2026-10-10', false);
    const all = await t.service.bouncedReport(A, { asOf: '2026-11-01' });
    expect([all.receivedTotal, all.issuedTotal]).toEqual([65, 7]);
    const onlyReceived = await t.service.bouncedReport(A, { asOf: '2026-11-01', direction: ChequeDirection.RECEIVED });
    expect(onlyReceived.items).toHaveLength(1);
    expect(onlyReceived.issuedTotal).toBe(0);
  });

  it('drops a cheque once it is cleared or returned, and never shows another tenant\'s cheques', async () => {
    const t = build();
    const c = await bounce(t, { amount: 10 }, '2026-10-01');
    expect((await t.service.bouncedReport(B, {})).items).toEqual([]);
    await t.service.transition(A, c.id, { status: ChequeStatus.RETURNED });
    expect((await t.service.bouncedReport(A, { asOf: '2026-11-01' })).items).toEqual([]);
  });
});

describe('ChequesService party codes on receivable/payable lines (CHK-01)', () => {
  const partyLines = (entry: Entry) => entry.lines.filter((l) => l.partyCode !== undefined);

  it('drawer party rides only the receivable line of a received cheque', async () => {
    const t = build();
    await t.service.create(A, received({ sayadNumber: undefined, partyCode: 'C-7' }) as never);
    expect(t.entries[0].lines.find((l) => l.accountCode === '1020')!.partyCode).toBe('C-7');
    expect(partyLines(t.entries[0])).toHaveLength(1);
  });

  it('drawer party rides the payable line of an issued cheque', async () => {
    const t = build();
    await t.service.create(A, issued({ partyCode: 'V-7' }) as never);
    expect(t.entries[0].lines.find((l) => l.accountCode === '2010')!.partyCode).toBe('V-7');
    expect(partyLines(t.entries[0])).toHaveLength(1);
  });

  it('endorsement puts the third party code on the payable line', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, partyCode: 'C-7' }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.SPENT, spentToName: 'تأمین‌کننده', spentToCode: 'S-7' });
    expect(t.entries[1].lines.find((l) => l.accountCode === '2010')!.partyCode).toBe('S-7');
    expect(partyLines(t.entries[1])).toHaveLength(1);
  });

  it('posts no party code when the cheque has none', async () => {
    const t = build();
    const c = await t.service.create(A, received({ sayadNumber: undefined, partyCode: undefined }) as never);
    await t.service.transition(A, c.id, { status: ChequeStatus.DEPOSITED });
    for (const entry of t.entries) expect(partyLines(entry)).toEqual([]);
  });
});

describe('ChequesService Ras-giri and Discounting (T72)', () => {
  it('calculates rasgiri and discounting from DTO inputs', async () => {
    const t = build();
    const ras = t.service.calculateRasgiri({
      items: [
        { amount: '50000000', dueDate: '2026-11-20' },
        { amount: '50000000', dueDate: '2026-11-30' },
      ],
      baseDate: '2026-11-10',
    });
    expect(ras.totalCount).toBe(2);
    expect(ras.totalAmount).toBe('100000000');
    expect(ras.weightedAverageDays).toBe(15);
    expect(ras.weightedMaturityDate).toBe('2026-11-25');

    const disc = t.service.calculateDiscount({
      items: [
        { amount: '50000000', dueDate: '2026-11-20' },
        { amount: '50000000', dueDate: '2026-11-30' },
      ],
      annualRatePercent: 24,
      baseDate: '2026-11-10',
    });
    expect(disc.annualRatePercent).toBe(24);
    expect(disc.totalAmount).toBe('100000000');
    expect(BigInt(disc.totalDiscountAmount) > 0n).toBe(true);
    expect(BigInt(disc.netPresentValue) < 100000000n).toBe(true);
  });

  it('calculates rasgiri and discounting for selected tenant cheques', async () => {
    const t = build();
    const c1 = await t.service.create(A, received({ sayadNumber: undefined, amount: 200, dueDate: '2026-11-20' }) as never);
    const c2 = await t.service.create(A, received({ sayadNumber: undefined, amount: 200, dueDate: '2026-11-30' }) as never);

    const ras = await t.service.calculateSelectionRasgiri(A, [c1.id, c2.id], '2026-11-10');
    expect(ras.totalCount).toBe(2);
    expect(ras.weightedAverageDays).toBe(15);

    const disc = await t.service.calculateSelectionDiscount(A, [c1.id, c2.id], 24, '2026-11-10');
    expect(disc.totalAmount).toBe('400');
    expect(disc.items).toHaveLength(2);
  });

  it('rejects cleared cheques with remainingAmount 0 and uses remainingAmount on partial cheques', async () => {
    const t = build();
    const cleared = await t.service.create(A, received({ sayadNumber: undefined, amount: 500, dueDate: '2026-11-20' }) as never);
    await t.service.transition(A, cleared.id, { status: ChequeStatus.CLEARED });

    await expect(
      t.service.calculateSelectionRasgiri(A, [cleared.id], '2026-11-10'),
    ).rejects.toThrow('تسویه یا بسته شده');
    await expect(
      t.service.calculateSelectionDiscount(A, [cleared.id], 24, '2026-11-10'),
    ).rejects.toThrow('تسویه یا بسته شده');

    const partial = await t.service.create(A, received({ sayadNumber: undefined, amount: 500, dueDate: '2026-11-20' }) as never);
    await t.service.partialPayment(A, partial.id, { amount: 200 });
    const rasPartial = await t.service.calculateSelectionRasgiri(A, [partial.id], '2026-11-10');
    expect(rasPartial.totalAmount).toBe('300');
  });
});
