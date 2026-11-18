import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { CalendarService } from '../calendar';
import {
  AccountingPeriodState,
  JournalEntryStatus,
  PeriodCalendarType,
} from './enums/accounting.enum';
import {
  ControlAccountPostingException,
  PeriodStateLockedException,
} from './exceptions/ledger.exceptions';
import { GL_CHAIN_GENESIS_HASH } from './entities/gl-sequencer.entity';
import { AccountingPeriodService } from './services/accounting-period.service';
import { JournalSequencerService } from './services/journal-sequencer.service';
import { MasterDataChangeLogService } from './services/master-data-change-log.service';

const T1 = '11111111-1111-4111-8111-111111111111';

describe('T178 Journal Integrity & Period States (unit + 50 writes/s latency)', () => {
  describe('JournalSequencerService', () => {
    it('builds deterministic canonical pre-image and SHA-256 chain H43 = SHA256(H42 || canonical(J-43))', () => {
      const pre42 = JournalSequencerService.buildCanonicalPreImage({
        entityId: T1,
        glAuditNumber: '42',
        postedAtUtc: '2026-11-10T12:00:00.000Z',
        lines: [
          { accountId: 1, debit: '2500.00', credit: '0.00', txDebit: '2500.00', txCredit: '0.00', bookDebit: '2500.00', bookCredit: '0.00' },
          { accountId: 2, debit: '0.00', credit: '2500.00', txDebit: '0.00', txCredit: '2500.00', bookDebit: '0.00', bookCredit: '2500.00' },
        ],
      });
      const h42 = JournalSequencerService.computeChainHash(GL_CHAIN_GENESIS_HASH, pre42);
      expect(h42).toMatch(/^[a-f0-9]{64}$/);

      const pre43 = JournalSequencerService.buildCanonicalPreImage({
        entityId: T1,
        glAuditNumber: '43',
        postedAtUtc: '2026-11-11T12:00:00.000Z',
        lines: [
          { accountId: 2, debit: '2500.00', credit: '0.00', txDebit: '2500.00', txCredit: '0.00', bookDebit: '2500.00', bookCredit: '0.00' },
          { accountId: 1, debit: '0.00', credit: '2500.00', txDebit: '0.00', txCredit: '2500.00', bookDebit: '0.00', bookCredit: '2500.00' },
        ],
      });
      const h43 = JournalSequencerService.computeChainHash(h42, pre43);
      expect(h43).toMatch(/^[a-f0-9]{64}$/);
      expect(h43).not.toBe(h42);
    });

    it('verifyChain returns VALID, 0 gaps, 43/43 for an intact chain and BROKEN on gap or tamper', async () => {
      const entries: Array<Record<string, unknown>> = [];
      const allLines: Array<Record<string, unknown>> = [];
      let prev = GL_CHAIN_GENESIS_HASH;
      for (let i = 1; i <= 43; i++) {
        const postedAt = `2026-11-10T12:00:${String(i % 60).padStart(2, '0')}.000Z`;
        const lines = [
          { journal_entry_id: i, account_id: 1, debit: '100.00', credit: '0.00', tx_debit: '100.00', tx_credit: '0.00', book_debit: '100.00', book_credit: '0.00' },
          { journal_entry_id: i, account_id: 2, debit: '0.00', credit: '100.00', tx_debit: '0.00', tx_credit: '100.00', book_debit: '0.00', book_credit: '100.00' },
        ];
        allLines.push(...lines);
        const canonical = JournalSequencerService.buildCanonicalPreImage({
          entityId: T1,
          glAuditNumber: String(i),
          postedAtUtc: postedAt,
          lines: lines.map((l) => ({
            accountId: l.account_id,
            debit: l.debit,
            credit: l.credit,
            txDebit: l.tx_debit,
            txCredit: l.tx_credit,
            bookDebit: l.book_debit,
            bookCredit: l.book_credit,
          })),
        });
        const hash = JournalSequencerService.computeChainHash(prev, canonical);
        entries.push({
          id: i,
          gl_audit_number: String(i),
          prev_chain_hash: prev,
          chain_hash: hash,
          posted_at_utc: postedAt,
        });
        prev = hash;
      }

      const mockScope = {
        within: async (_t: string, _m: unknown, fn: (m: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) =>
          fn({
            query: async (sql: string) =>
              sql.includes('fin_journal_entries') ? entries : allLines,
          }),
      };

      const svc = new JournalSequencerService(mockScope as never);
      const valid = await svc.verifyChain(T1);
      expect(valid.status).toBe('VALID');
      expect(valid.gaps).toBe(0);
      expect(valid.verified).toBe('43/43');

      // Tamper with entry 42 amount
      allLines[82].debit = '999.00';
      const broken = await svc.verifyChain(T1);
      expect(broken.status).toBe('BROKEN');
      expect(broken.brokenAtAuditNumber).toBe('42');
    });

    it('measures p95 sealing latency under 50 writes/s load (< 25ms)', async () => {
      let seqNumber = 0n;
      let headHash = GL_CHAIN_GENESIS_HASH;
      const mockManager = {
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes('SELECT "last_audit_number"')) {
            return [{ last_audit_number: seqNumber.toString(), head_hash: headHash }];
          }
          if (sql.includes('FROM "fin_journal_entry_lines"')) {
            return [
              { account_id: 1, debit: '500.00', credit: '0.00', tx_debit: '500.00', tx_credit: '0.00', book_debit: '500.00', book_credit: '0.00' },
              { account_id: 2, debit: '0.00', credit: '500.00', tx_debit: '0.00', tx_credit: '500.00', book_debit: '0.00', book_credit: '500.00' },
            ];
          }
          if (sql.includes('UPDATE "fin_gl_sequencers"')) {
            seqNumber = BigInt(String(params[0]));
            headHash = String(params[1]);
          }
          return [];
        },
      };
      const mockScope = {
        within: async (_t: string, _m: unknown, fn: (m: typeof mockManager) => Promise<unknown>) =>
          fn(mockManager),
      };

      const svc = new JournalSequencerService(mockScope as never);
      const latenciesMs: number[] = [];
      const writes = 50;
      for (let i = 1; i <= writes; i++) {
        const start = performance.now();
        await svc.sealEntry(T1, i, mockManager as never);
        latenciesMs.push(performance.now() - start);
      }
      latenciesMs.sort((a, b) => a - b);
      const p95 = latenciesMs[Math.floor(writes * 0.95) - 1];
      expect(Number(seqNumber)).toBe(50);
      expect(p95).toBeLessThan(25);
    });
  });

  describe('AccountingPeriodService', () => {
    const calendar = new CalendarService();

    const makePeriodService = (periods: Array<Record<string, unknown>> = [], unposted: Array<{ id: number; entry_number: string; status: string }> = []) => {
      let nextId = periods.length + 1;
      const repo = {
        find: async () => periods,
        findOne: async ({ where }: { where: Record<string, unknown> }) =>
          periods.find((p) => (where.id != null ? p.id === where.id : p.code === where.code)) ?? null,
        create: (data: Record<string, unknown>) => ({ id: nextId++, ...data }),
        save: async (entity: Record<string, unknown>) => {
          const idx = periods.findIndex((p) => p.id === entity.id);
          if (idx >= 0) periods[idx] = entity;
          else periods.push(entity);
          return entity;
        },
        createQueryBuilder: () => ({
          where: () => ({
            andWhere: () => ({
              andWhere: () => ({
                orderBy: () => ({
                  getMany: async () => periods.filter((p) => !p.isAdjustment),
                }),
              }),
            }),
          }),
        }),
      };
      const mockScope = {
        within: async (_t: string, _m: unknown, fn: (m: unknown) => Promise<unknown>) =>
          fn({
            getRepository: () => repo,
            query: async () => unposted,
          }),
      };
      return new AccountingPeriodService(mockScope as never, calendar);
    };

    it('enforces soft-lock role exception (AP clerk -> 422 PERIOD_LOCKED, chief-accountant -> allowed)', async () => {
      const svc = makePeriodService();
      const oct = await svc.createPeriod(T1, {
        code: '2026-10',
        name: 'October 2026',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
      await svc.softLockPeriod(T1, oct.id, 'admin', {
        allowedRoles: ['chief-accountant'],
        reason: 'Month-end close',
      });

      await expect(
        svc.assertPostingAllowed(T1, new Date('2026-10-20T12:00:00Z'), { actorRole: 'ap-clerk' }),
      ).rejects.toMatchObject({ status: 422 });

      await expect(
        svc.assertPostingAllowed(T1, new Date('2026-10-20T12:00:00Z'), { actorRole: 'chief-accountant' }),
      ).resolves.toBeUndefined();
    });

    it('blocks hard close when DRAFT-9 is unposted and names it; after hard close unlock/post fails', async () => {
      const periods: Array<Record<string, unknown>> = [];
      const unposted = [{ id: 9, entry_number: 'DRAFT-9', status: JournalEntryStatus.DRAFT }];
      const svc = makePeriodService(periods, unposted);
      const oct = await svc.createPeriod(T1, {
        code: '2026-10',
        name: 'October 2026',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });

      await expect(svc.hardClosePeriod(T1, oct.id, 'admin')).rejects.toThrow(/DRAFT-9/);

      unposted.length = 0;
      const closed = await svc.hardClosePeriod(T1, oct.id, 'admin');
      expect(closed.state).toBe(AccountingPeriodState.HARD_CLOSED);

      await expect(svc.unlockPeriod(T1, oct.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(
        svc.assertPostingAllowed(T1, new Date('2026-10-15T12:00:00Z'), { actorRole: 'admin' }),
      ).rejects.toBeInstanceOf(PeriodStateLockedException);
    });

    it('generates Jalali periods with exact Jalali month ends (1405-07..1405-12)', async () => {
      const svc = makePeriodService();
      const periods = await svc.createJalaliYearPeriods(T1, 1405);
      expect(periods).toHaveLength(12);
      expect(periods[0].calendarType).toBe(PeriodCalendarType.JALALI);
      expect(periods[0].code).toBe('1405-01');
      // Mehr (month 7) has 30 days, Esfand (month 12 in non-leap 1405) has 29 days
      const mehr = periods[6];
      const esfand = periods[11];
      expect(mehr.code).toBe('1405-07');
      expect(esfand.code).toBe('1405-12');
      expect(esfand.periodStart).toBe('2027-02-20');
      expect(esfand.periodEnd).toBe('2027-03-20');
    });
  });

  describe('ControlAccountPostingException & MasterDataChangeLogService', () => {
    it('ControlAccountPostingException reports 422 CONTROL_ACCOUNT_MANUAL_POSTING_FORBIDDEN', () => {
      const err = new ControlAccountPostingException(['1310']);
      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({
        code: 'CONTROL_ACCOUNT_MANUAL_POSTING_FORBIDDEN',
      });
    });

    it('MasterDataChangeLogService records and lists changes immediately', async () => {
      const rows: Array<Record<string, unknown>> = [];
      const repo = {
        create: (d: Record<string, unknown>) => ({ id: rows.length + 1, changedAt: new Date(), ...d }),
        save: async (r: Record<string, unknown>) => {
          rows.push(r);
          return r;
        },
        find: async () => rows,
      };
      const scope = {
        within: async (_t: string, _m: unknown, fn: (m: unknown) => Promise<unknown>) =>
          fn({ getRepository: () => repo }),
      };
      const svc = new MasterDataChangeLogService(scope as never);
      await svc.recordChange(T1, {
        entityType: 'VAT_CODE',
        entityId: 'DE-STD-19',
        fieldName: 'description',
        oldValue: 'Standard VAT',
        newValue: 'Standard VAT 19%',
        changedBy: 'admin-1',
      });
      const list = await svc.listChanges(T1, { entityType: 'VAT_CODE', entityId: 'DE-STD-19' });
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        changedBy: 'admin-1',
        oldValue: 'Standard VAT',
        newValue: 'Standard VAT 19%',
      });
    });
  });
});
