import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { fromDb, fromMinor, toMinor } from '../../accounting/money';
import { StatementLineStatus } from '../../banking/enums/banking.enum';
import { BankingService } from '../../banking/services/banking.service';
import {
  ChequeReconApplyDto,
  ChequeReconApplyResponseDto,
  ChequeReconItemDto,
  ChequeReconMatchDto,
  ChequeReconResponseDto,
  QueryChequeReconDto,
} from '../dto/cheque.dto';
import { ChequeEventEntity } from '../entities/cheque-event.entity';
import { ChequeDirection } from '../enums/cheque.enum';
import { ChequesRepository } from '../repositories/cheques.repository';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 5;
const dayNumber = (date: string): number => Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`) / DAY_MS);

/** Rial amounts from the banking DTOs (JS numbers) to exact minor units. */
const minorOf = (value: number | string): bigint => {
  try {
    return toMinor(String(value));
  } catch {
    return -1n; // an amount we cannot read never matches
  }
};

/**
 * Matches cheque clearings to bank statement lines. It only uses the banking module's public
 * `BankingService` (statement lines, book lines, manual match); it never touches the recon tables.
 *
 * A clearing event is a `cleared` move or a partial payment: each posted one journal entry whose
 * bank-side line (debit for a received cheque, credit for an issued one, on the account the bank
 * account is linked to) should appear on the statement. A clearing that carried a `bankAccountId`
 * posts to that account's ledger; an old event (null) posted to 1010, so a bank account linked to
 * another ledger account still shows `no_bank_line` for it.
 */
@Injectable()
export class ChequeReconService {
  constructor(
    private readonly chequesRepository: ChequesRepository,
    private readonly bankingService: BankingService,
  ) {}

  async suggest(tenantId: string, query: QueryChequeReconDto): Promise<ChequeReconResponseDto> {
    const items = (await this.build(tenantId, query.bankAccountId, query)).map((r) => r.item);
    const counts: Record<string, number> = { reconciled: 0, suggested: 0, unmatched: 0, no_bank_line: 0 };
    for (const item of items) counts[item.state] += 1;
    return { items, counts };
  }

  /** Confirms one suggested pair. The banking module re-checks amount, direction and double matches. */
  async match(tenantId: string, dto: ChequeReconMatchDto): Promise<ChequeReconItemDto> {
    const event = await this.chequesRepository.findClearingEvent(tenantId, dto.eventId);
    if (!event) throw new NotFoundException('رویداد وصول چک یافت نشد.');
    const [row] = await this.build(tenantId, dto.bankAccountId, {}, [event]);
    if (!row || row.item.state === 'no_bank_line') {
      throw new BadRequestException('سند وصول این چک روی حساب دفتر کل این حساب بانکی نیست.');
    }
    if (row.item.state === 'reconciled') throw new BadRequestException('این وصول قبلاً با صورتحساب تطبیق خورده است.');
    await this.bankingService.manualMatch(tenantId, dto.statementLineId, row.bookLineId!);
    return { ...row.item, state: 'reconciled', matchedStatementLineId: dto.statementLineId, candidates: [] };
  }

  /**
   * Applies every suggestion that has exactly one candidate that no other item also wants. Not one
   * transaction: each pair is confirmed on its own, a pair the banking module refuses is counted in
   * `failed` and the rest still apply.
   */
  async applyUnambiguous(tenantId: string, dto: ChequeReconApplyDto): Promise<ChequeReconApplyResponseDto> {
    const rows = await this.build(tenantId, dto.bankAccountId, dto);
    const wanted = new Map<number, number>();
    for (const { item } of rows) for (const c of item.candidates) wanted.set(c.statementLineId, (wanted.get(c.statementLineId) ?? 0) + 1);
    let matched = 0;
    let skippedAmbiguous = 0;
    let failed = 0;
    for (const { item, bookLineId } of rows.filter((r) => r.item.state === 'suggested')) {
      const only = item.candidates.length === 1 ? item.candidates[0] : null;
      if (!only || wanted.get(only.statementLineId) !== 1 || bookLineId === null) {
        skippedAmbiguous += 1;
        continue;
      }
      try {
        await this.bankingService.manualMatch(tenantId, only.statementLineId, bookLineId);
        matched += 1;
      } catch {
        failed += 1;
      }
    }
    return { matched, skippedAmbiguous, failed };
  }

  // ------------------------------------------------------------------ internals

  /**
   * One pass: the events, their cheques, and one book-line and one statement-line read limited to the
   * events' date range (statement lines widened by the window), indexed by journal entry.
   */
  private async build(
    tenantId: string,
    bankAccountId: number,
    range: { fromDate?: string; toDate?: string; windowDays?: number },
    only?: ChequeEventEntity[],
  ): Promise<Array<{ item: ChequeReconItemDto; bookLineId: number | null }>> {
    const events =
      only ??
      (await this.chequesRepository.listClearingEvents(tenantId, { from: range.fromDate?.slice(0, 10), to: range.toDate?.slice(0, 10) }));
    if (events.length === 0) return [];
    const windowDays = range.windowDays ?? DEFAULT_WINDOW_DAYS;
    const dates = events.map((e) => e.eventDate).sort();
    const shift = (date: string, days: number) => new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
    const cheques = new Map(
      (await this.chequesRepository.findByIds(tenantId, [...new Set(events.map((e) => e.chequeId))])).map((c) => [c.id, c]),
    );
    const [bookLines, unmatched] = await Promise.all([
      this.bankingService.listBookLines(tenantId, bankAccountId, { fromDate: dates[0], toDate: dates[dates.length - 1] }),
      this.bankingService.listStatementLines(tenantId, bankAccountId, {
        status: StatementLineStatus.UNMATCHED,
        fromDate: shift(dates[0], -windowDays),
        toDate: shift(dates[dates.length - 1], windowDays),
      }),
    ]);
    const bookByEntry = new Map<number, typeof bookLines>();
    for (const line of bookLines) bookByEntry.set(line.journalEntryId, [...(bookByEntry.get(line.journalEntryId) ?? []), line]);

    return events.flatMap((event) => {
      const cheque = cheques.get(event.chequeId);
      if (!cheque || event.journalEntryId === null) return [];
      const amount = fromDb(event.amount ?? cheque.amount);
      const received = cheque.direction === ChequeDirection.RECEIVED;
      const bookLine = (bookByEntry.get(event.journalEntryId) ?? []).find((l) => minorOf(received ? l.debit : l.credit) === amount);
      const base = {
        eventId: event.id,
        chequeId: cheque.id,
        direction: cheque.direction,
        chequeNumber: cheque.chequeNumber,
        sayadNumber: cheque.sayadNumber,
        partyName: cheque.partyName,
        eventDate: event.eventDate,
        amount: fromMinor(amount),
        journalEntryId: event.journalEntryId,
      };
      const done = (item: Omit<ChequeReconItemDto, keyof typeof base>, id: number | null) => ({ item: { ...base, ...item } as ChequeReconItemDto, bookLineId: id });
      if (!bookLine) return [done({ state: 'no_bank_line', matchedStatementLineId: null, candidates: [] }, null)];
      if (bookLine.matchedStatementLineId !== null) {
        return [done({ state: 'reconciled', matchedStatementLineId: bookLine.matchedStatementLineId, candidates: [] }, bookLine.id)];
      }
      const candidates = unmatched
        .filter(
          (s) =>
            minorOf(received ? s.deposit : s.withdrawal) === amount &&
            Math.abs(dayNumber(s.txnDate) - dayNumber(event.eventDate)) <= windowDays,
        )
        .map((s) => ({ statementLineId: s.id, txnDate: s.txnDate, description: s.description, reference: s.reference }));
      return [done({ state: candidates.length ? 'suggested' : 'unmatched', matchedStatementLineId: null, candidates }, bookLine.id)];
    });
  }
}
