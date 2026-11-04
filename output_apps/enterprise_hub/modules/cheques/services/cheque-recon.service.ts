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
 * account is linked to) should appear on the statement. The cheque module posts to 1010, so a bank
 * account linked to another ledger account shows `no_bank_line` until accounting maps it.
 */
@Injectable()
export class ChequeReconService {
  constructor(
    private readonly chequesRepository: ChequesRepository,
    private readonly bankingService: BankingService,
  ) {}

  async suggest(tenantId: string, query: QueryChequeReconDto): Promise<ChequeReconResponseDto> {
    const items = await this.build(tenantId, query.bankAccountId, query);
    const counts: Record<string, number> = { reconciled: 0, suggested: 0, unmatched: 0, no_bank_line: 0 };
    for (const item of items) counts[item.state] += 1;
    return { items, counts };
  }

  /** Confirms one suggested pair. The banking module re-checks amount, direction and double matches. */
  async match(tenantId: string, dto: ChequeReconMatchDto): Promise<ChequeReconItemDto> {
    const events = await this.chequesRepository.listClearingEvents(tenantId);
    const event = events.find((e) => e.id === dto.eventId);
    if (!event) throw new NotFoundException('رویداد وصول چک یافت نشد.');
    const items = await this.build(tenantId, dto.bankAccountId, {}, [event]);
    const item = items[0];
    if (item.state === 'no_bank_line') {
      throw new BadRequestException('سند وصول این چک روی حساب دفتر کل این حساب بانکی نیست.');
    }
    if (item.state === 'reconciled') throw new BadRequestException('این وصول قبلاً با صورتحساب تطبیق خورده است.');
    const bookLine = await this.bookLineOf(tenantId, dto.bankAccountId, event, item.direction);
    if (!bookLine) throw new BadRequestException('سطر دفتر این وصول یافت نشد.');
    await this.bankingService.manualMatch(tenantId, dto.statementLineId, bookLine.id);
    return (await this.build(tenantId, dto.bankAccountId, {}, [event]))[0];
  }

  /** Applies every suggestion that has exactly one candidate and whose candidate no other item wants. */
  async applyUnambiguous(tenantId: string, dto: ChequeReconApplyDto): Promise<ChequeReconApplyResponseDto> {
    const items = await this.build(tenantId, dto.bankAccountId, dto);
    const wanted = new Map<number, number>();
    for (const item of items) for (const c of item.candidates) wanted.set(c.statementLineId, (wanted.get(c.statementLineId) ?? 0) + 1);
    let matched = 0;
    let skippedAmbiguous = 0;
    for (const item of items.filter((i) => i.state === 'suggested')) {
      const only = item.candidates.length === 1 ? item.candidates[0] : null;
      if (!only || wanted.get(only.statementLineId) !== 1) {
        skippedAmbiguous += 1;
        continue;
      }
      await this.match(tenantId, { bankAccountId: dto.bankAccountId, eventId: item.eventId, statementLineId: only.statementLineId });
      matched += 1;
    }
    return { matched, skippedAmbiguous };
  }

  // ------------------------------------------------------------------ internals

  private async bookLineOf(tenantId: string, bankAccountId: number, event: ChequeEventEntity, direction: ChequeDirection) {
    const amount = fromDb(event.amount ?? '0');
    const lines = await this.bankingService.listBookLines(tenantId, bankAccountId, {});
    return lines.find(
      (l) =>
        l.journalEntryId === event.journalEntryId &&
        minorOf(direction === ChequeDirection.RECEIVED ? l.debit : l.credit) === amount,
    );
  }

  private async build(
    tenantId: string,
    bankAccountId: number,
    range: { fromDate?: string; toDate?: string; windowDays?: number },
    only?: ChequeEventEntity[],
  ): Promise<ChequeReconItemDto[]> {
    const events = only ?? (await this.chequesRepository.listClearingEvents(tenantId, { from: range.fromDate?.slice(0, 10), to: range.toDate?.slice(0, 10) }));
    if (events.length === 0) return [];
    const windowDays = range.windowDays ?? DEFAULT_WINDOW_DAYS;
    const cheques = new Map((await this.chequesRepository.findByIds(tenantId, [...new Set(events.map((e) => e.chequeId))])).map((c) => [c.id, c]));
    const [bookLines, unmatched] = await Promise.all([
      this.bankingService.listBookLines(tenantId, bankAccountId, {}),
      this.bankingService.listStatementLines(tenantId, bankAccountId, { status: StatementLineStatus.UNMATCHED }),
    ]);
    const used = new Set<number>();
    return events.flatMap((event): ChequeReconItemDto[] => {
      const cheque = cheques.get(event.chequeId);
      if (!cheque || event.journalEntryId === null) return [];
      const amount = fromDb(event.amount ?? cheque.amount);
      const received = cheque.direction === ChequeDirection.RECEIVED;
      const bookLine = bookLines.find(
        (l) => l.journalEntryId === event.journalEntryId && minorOf(received ? l.debit : l.credit) === amount,
      );
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
      if (!bookLine) return [{ ...base, state: 'no_bank_line', matchedStatementLineId: null, candidates: [] }];
      if (bookLine.matchedStatementLineId !== null) {
        return [{ ...base, state: 'reconciled', matchedStatementLineId: bookLine.matchedStatementLineId, candidates: [] }];
      }
      const candidates = unmatched
        .filter(
          (s) =>
            minorOf(received ? s.deposit : s.withdrawal) === amount &&
            Math.abs(dayNumber(s.txnDate) - dayNumber(event.eventDate)) <= windowDays,
        )
        .map((s) => ({ statementLineId: s.id, txnDate: s.txnDate, description: s.description, reference: s.reference }));
      candidates.forEach((c) => used.add(c.statementLineId));
      return [{ ...base, state: candidates.length ? 'suggested' : 'unmatched', matchedStatementLineId: null, candidates }];
    });
  }
}
