import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { MoneyFormatError, fromDb, fromMinor, minorToDecimal, toMinor } from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import {
  CHEQUE_ACCOUNTS,
  CHEQUE_ACCOUNT_DEFINITIONS,
  DEFAULT_DUE_WINDOW_DAYS,
  PG_UNIQUE_VIOLATION,
} from '../constants/cheque.constants';
import {
  ChequeDetailResponseDto,
  ChequeEventResponseDto,
  ChequeResponseDto,
  CreateChequeDto,
  DueChequesResponseDto,
  QueryChequesDto,
  QueryDueChequesDto,
  BouncedChequesResponseDto,
  PartialPaymentDto,
  QueryBouncedChequesDto,
  TransitionChequeDto,
  VerifySayadDto,
} from '../dto/cheque.dto';
import { ChequeEventEntity } from '../entities/cheque-event.entity';
import { ChequeEntity } from '../entities/cheque.entity';
import { ChequeStatus } from '../enums/cheque.enum';
import {
  BLOCKED_AFTER_PARTIAL,
  OPEN_STATUSES,
  PostingLine,
  allowedTargets,
  creationPosting,
  findRule,
  partialPaymentPosting,
} from '../lifecycle/cheque-lifecycle';
import { SayadRegistrationStatus, isValidReceiverNationalId, isValidSayadNumber } from '../sayad/sayad';
import { ChequesRepository } from '../repositories/cheques.repository';

const DAY_MS = 86_400_000;

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === PG_UNIQUE_VIOLATION || e?.driverError?.code === PG_UNIQUE_VIOLATION;
}

const dateOnly = (value: string): string => value.slice(0, 10);
const todayUtc = (): string => new Date().toISOString().slice(0, 10);
const dayNumber = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
const addDays = (date: string, days: number): string =>
  new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);

/**
 * Cheque register and lifecycle (received and issued).
 *
 * Every state change that has a ledger effect posts one balanced journal entry
 * through `AccountingService.createJournalEntry` inside the same transaction as
 * the status change and the event row, so a failed posting leaves the cheque
 * untouched. The accounting module itself is not modified: the three cheque
 * accounts (1110, 1120, 2110) are created per tenant on first use via the public
 * `createAccount`. No Sayad network call is made anywhere in this module.
 */
@Injectable()
export class ChequesService {
  constructor(
    private readonly chequesRepository: ChequesRepository,
    private readonly accountingService: AccountingService,
  ) {}

  async create(tenantId: string, dto: CreateChequeDto, actor = 'unknown'): Promise<ChequeResponseDto> {
    if (dto.sayadNumber && !isValidSayadNumber(dto.sayadNumber)) {
      throw new BadRequestException('شناسه صیاد نامعتبر است (۱۶ رقم، نه یک رقم تکراری).');
    }
    if (dto.receiverNationalId && !isValidReceiverNationalId(dto.receiverNationalId)) {
      throw new BadRequestException('کد/شناسه ملی دریافت‌کننده نامعتبر است.');
    }
    if (dto.sayadVerified && !dto.sayadNumber) {
      throw new BadRequestException('تأیید صیاد بدون شناسه صیاد ممکن نیست.');
    }
    const issueDate = dateOnly(dto.issueDate);
    const dueDate = dateOnly(dto.dueDate);
    if (dueDate < issueDate) {
      throw new BadRequestException('تاریخ سررسید نمی‌تواند پیش از تاریخ صدور باشد.');
    }
    if (dto.sayadNumber && (await this.chequesRepository.findBySayadNumber(tenantId, dto.sayadNumber))) {
      throw new ConflictException('چکی با این شناسه صیاد قبلاً ثبت شده است.');
    }
    let amountMinor: bigint;
    try {
      amountMinor = toMinor(dto.amount);
    } catch (error) {
      if (error instanceof MoneyFormatError) throw new BadRequestException(error.message);
      throw error;
    }
    if (amountMinor <= 0n) {
      throw new BadRequestException('مبلغ چک باید بزرگ‌تر از صفر باشد.');
    }
    await this.ensureAccounts(tenantId);

    try {
      const saved = await this.chequesRepository.runInTransaction(tenantId, async (manager) => {
        const cheque = await this.chequesRepository.create(
          tenantId,
          {
            direction: dto.direction,
            sayadNumber: dto.sayadNumber ?? null,
            sayadVerified: dto.sayadVerified ?? false,
            sayadRegistrationStatus: dto.sayadRegistrationStatus ?? SayadRegistrationStatus.UNKNOWN,
            sayadVerifiedBy: dto.sayadVerified ? actor : null,
            sayadVerifiedAt: dto.sayadVerified ? new Date() : null,
            receiverNationalId: dto.receiverNationalId ?? null,
            chequeNumber: dto.chequeNumber,
            bankName: dto.bankName ?? null,
            amount: minorToDecimal(amountMinor),
            issueDate,
            dueDate,
            partyName: dto.partyName,
            partyCode: dto.partyCode ?? null,
            description: dto.description ?? null,
          },
          manager,
        );
        const posting = creationPosting(cheque.direction, amountMinor);
        const journalEntryId = await this.post(tenantId, cheque, 'new', issueDate, posting.description, posting.lines, manager);
        await this.chequesRepository.addEvent(
          tenantId,
          { chequeId: cheque.id, fromStatus: null, toStatus: ChequeStatus.REGISTERED, eventDate: issueDate, journalEntryId, amount: minorToDecimal(amountMinor), note: null },
          manager,
        );
        return cheque;
      });
      return this.toDto(saved);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('چکی با این شناسه صیاد قبلاً ثبت شده است.');
      }
      throw error;
    }
  }

  async transition(tenantId: string, id: number, dto: TransitionChequeDto): Promise<ChequeDetailResponseDto> {
    await this.ensureAccounts(tenantId);
    const eventDate = dto.eventDate ? dateOnly(dto.eventDate) : todayUtc();

    await this.chequesRepository.runInTransaction(tenantId, async (manager) => {
      const cheque = await this.chequesRepository.findByIdForUpdate(tenantId, id, manager);
      if (!cheque) {
        throw new NotFoundException('چک یافت نشد.');
      }
      const rule = findRule(cheque.direction, cheque.status, dto.status);
      if (!rule) {
        const allowed = allowedTargets(cheque.direction, cheque.status);
        throw new BadRequestException(
          allowed.length
            ? `انتقال از «${cheque.status}» به «${dto.status}» مجاز نیست. وضعیت‌های مجاز: ${allowed.join('، ')}.`
            : `چک در وضعیت نهایی «${cheque.status}» است و تغییر نمی‌کند.`,
        );
      }
      const spentToName = dto.spentToName?.trim();
      if (dto.status === ChequeStatus.SPENT && !spentToName) {
        throw new BadRequestException('برای خرج چک، نام شخص ثالث الزامی است.');
      }
      if (dto.spentToNationalId && !isValidReceiverNationalId(dto.spentToNationalId)) {
        throw new BadRequestException('کد/شناسه ملی شخص ثالث نامعتبر است.');
      }
      const settled = fromDb(cheque.settledAmount ?? '0');
      if (settled > 0n && BLOCKED_AFTER_PARTIAL.includes(dto.status)) {
        throw new BadRequestException('چکی که بخشی از آن پرداخت شده قابل خرج نیست.');
      }
      const remaining = fromDb(cheque.amount) - settled;
      if (eventDate < cheque.issueDate) {
        throw new BadRequestException('تاریخ رویداد نمی‌تواند پیش از تاریخ صدور چک باشد.');
      }

      const journalEntryId = rule.lines
        ? await this.post(tenantId, cheque, dto.status, eventDate, rule.description, rule.lines(remaining), manager, dto.spentToCode)
        : null;
      const closes = dto.status === ChequeStatus.CLEARED;
      await this.chequesRepository.updateStatus(
        tenantId,
        id,
        {
          status: dto.status,
          // the closing payment settles whatever was left
          ...(closes ? { settledAmount: cheque.amount } : {}),
          ...(dto.status === ChequeStatus.SPENT
            ? { spentToName: spentToName ?? null, spentToCode: dto.spentToCode ?? null, spentToNationalId: dto.spentToNationalId ?? null }
            : {}),
        },
        manager,
      );
      await this.chequesRepository.addEvent(
        tenantId,
        {
          chequeId: id,
          fromStatus: cheque.status,
          toStatus: dto.status,
          eventDate,
          journalEntryId,
          amount: journalEntryId === null ? null : minorToDecimal(remaining),
          note: dto.note ?? null,
        },
        manager,
      );
    });
    return this.get(tenantId, id);
  }

  /**
   * The bank paid part of the face value. Posts the clearing entry for that part only; the cheque
   * keeps its status and the rest is still collectible (or can bounce later for the remainder).
   * A payment that would take the whole remainder is rejected: use the normal clear move.
   */
  async partialPayment(tenantId: string, id: number, dto: PartialPaymentDto): Promise<ChequeDetailResponseDto> {
    let paid: bigint;
    try {
      paid = toMinor(dto.amount);
    } catch (error) {
      if (error instanceof MoneyFormatError) throw new BadRequestException(error.message);
      throw error;
    }
    if (paid <= 0n) throw new BadRequestException('مبلغ پرداخت باید بزرگ‌تر از صفر باشد.');
    await this.ensureAccounts(tenantId);
    const eventDate = dto.eventDate ? dateOnly(dto.eventDate) : todayUtc();

    await this.chequesRepository.runInTransaction(tenantId, async (manager) => {
      const cheque = await this.chequesRepository.findByIdForUpdate(tenantId, id, manager);
      if (!cheque) throw new NotFoundException('چک یافت نشد.');
      const settled = fromDb(cheque.settledAmount ?? '0');
      const remaining = fromDb(cheque.amount) - settled;
      const posting = partialPaymentPosting(cheque.direction, cheque.status, paid);
      if (!posting) {
        throw new BadRequestException(`پرداخت بخشی از چک در وضعیت «${cheque.status}» مجاز نیست.`);
      }
      if (paid >= remaining) {
        throw new BadRequestException('مبلغ پرداخت باید کمتر از مانده چک باشد؛ برای پرداخت کامل، وضعیت را «وصول/پاس» کنید.');
      }
      if (eventDate < cheque.issueDate) {
        throw new BadRequestException('تاریخ رویداد نمی‌تواند پیش از تاریخ صدور چک باشد.');
      }
      const journalEntryId = await this.post(tenantId, cheque, 'partial', eventDate, posting.description, posting.lines, manager);
      await this.chequesRepository.updateStatus(tenantId, id, { settledAmount: minorToDecimal(settled + paid) }, manager);
      await this.chequesRepository.addEvent(
        tenantId,
        {
          chequeId: id,
          fromStatus: cheque.status,
          toStatus: cheque.status,
          eventDate,
          journalEntryId,
          amount: minorToDecimal(paid),
          note: dto.note ?? 'پرداخت بخشی از وجه چک',
        },
        manager,
      );
    });
    return this.get(tenantId, id);
  }

  /**
   * Records that a person looked the cheque up in Sayad (or withdraws that claim). The flag is manual:
   * no Sayad call is made. Who and when are stored, and an event row keeps the history.
   */
  async verifySayad(tenantId: string, id: number, actor: string, dto: VerifySayadDto): Promise<ChequeDetailResponseDto> {
    await this.chequesRepository.runInTransaction(tenantId, async (manager) => {
      const cheque = await this.chequesRepository.findByIdForUpdate(tenantId, id, manager);
      if (!cheque) throw new NotFoundException('چک یافت نشد.');
      if (dto.verified && !cheque.sayadNumber) {
        throw new BadRequestException('برای تأیید صیاد، ابتدا شناسه صیاد چک را ثبت کنید.');
      }
      await this.chequesRepository.updateStatus(
        tenantId,
        id,
        {
          sayadVerified: dto.verified,
          sayadVerifiedBy: dto.verified ? actor : null,
          sayadVerifiedAt: dto.verified ? new Date() : null,
          ...(dto.sayadRegistrationStatus ? { sayadRegistrationStatus: dto.sayadRegistrationStatus } : {}),
        },
        manager,
      );
      await this.chequesRepository.addEvent(
        tenantId,
        {
          chequeId: id,
          fromStatus: cheque.status,
          toStatus: cheque.status,
          eventDate: todayUtc(),
          journalEntryId: null,
          amount: null,
          note: dto.note ?? (dto.verified ? `تأیید دستی صیاد توسط ${actor}` : `لغو تأیید صیاد توسط ${actor}`),
        },
        manager,
      );
    });
    return this.get(tenantId, id);
  }

  async get(tenantId: string, id: number): Promise<ChequeDetailResponseDto> {
    const cheque = await this.chequesRepository.findById(tenantId, id);
    if (!cheque) {
      throw new NotFoundException('چک یافت نشد.');
    }
    const events = await this.chequesRepository.listEvents(tenantId, id);
    return { ...this.toDto(cheque), events: events.map((event) => this.toEventDto(event)) };
  }

  async list(tenantId: string, query: QueryChequesDto): Promise<ChequeResponseDto[]> {
    const rows = await this.chequesRepository.list(tenantId, {
      direction: query.direction,
      status: query.status,
      dueFrom: query.dueFrom ? dateOnly(query.dueFrom) : undefined,
      dueTo: query.dueTo ? dateOnly(query.dueTo) : undefined,
    });
    return rows.map((row) => this.toDto(row));
  }

  /** Open cheques due within the window plus everything already overdue. */
  async listDue(tenantId: string, query: QueryDueChequesDto): Promise<DueChequesResponseDto> {
    const asOf = query.asOf ? dateOnly(query.asOf) : todayUtc();
    const until = addDays(asOf, query.days ?? DEFAULT_DUE_WINDOW_DAYS);
    const rows = await this.chequesRepository.listOpenDueBy(tenantId, OPEN_STATUSES, until);
    const items = rows.map((row) => {
      const daysUntilDue = dayNumber(row.dueDate) - dayNumber(asOf);
      return { ...this.toDto(row), daysUntilDue, overdue: daysUntilDue < 0 };
    });
    const total = (direction: string) =>
      fromMinor(rows.filter((r) => r.direction === direction).reduce((sum, r) => sum + fromDb(r.amount) - fromDb(r.settledAmount ?? '0'), 0n));
    return { asOf, until, items, receivedTotal: total('received'), issuedTotal: total('issued') };
  }

  /**
   * Bounced cheques with ageing. The age counts from the latest bounce event (the cheque's due date
   * when no event exists, e.g. imported rows). Amounts are the unpaid remainder, so a partly paid
   * cheque that bounced for the rest is reported for the rest only.
   */
  async bouncedReport(tenantId: string, query: QueryBouncedChequesDto): Promise<BouncedChequesResponseDto> {
    const asOf = query.asOf ? dateOnly(query.asOf) : todayUtc();
    const all = await this.chequesRepository.listByStatus(tenantId, ChequeStatus.BOUNCED);
    const rows = query.direction ? all.filter((c) => c.direction === query.direction) : all;
    const events = await this.chequesRepository.listEventsToStatus(
      tenantId,
      rows.map((c) => c.id),
      ChequeStatus.BOUNCED,
    );
    const bouncedOn = new Map<number, string>();
    for (const event of events) if (!bouncedOn.has(event.chequeId)) bouncedOn.set(event.chequeId, event.eventDate); // newest first

    const bucketOf = (age: number): string => (age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+');
    const remainingOf = (c: ChequeEntity): bigint => fromDb(c.amount) - fromDb(c.settledAmount ?? '0');
    const items = rows
      .map((row) => {
        const on = bouncedOn.get(row.id) ?? row.dueDate;
        const ageDays = Math.max(0, dayNumber(asOf) - dayNumber(on));
        return { ...this.toDto(row), bouncedOn: on, ageDays, bucket: bucketOf(ageDays) };
      })
      .sort((a, b) => b.ageDays - a.ageDays || a.id - b.id);

    const sum = (list: ChequeEntity[], direction: string) =>
      fromMinor(list.filter((c) => c.direction === direction).reduce((t, c) => t + remainingOf(c), 0n));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const buckets = ['0-30', '31-60', '61-90', '90+'].map((bucket) => {
      const inBucket = items.filter((i) => i.bucket === bucket).map((i) => byId.get(i.id)!);
      return { bucket, count: inBucket.length, receivedTotal: sum(inBucket, 'received'), issuedTotal: sum(inBucket, 'issued') };
    });
    return { asOf, items, buckets, receivedTotal: sum(rows, 'received'), issuedTotal: sum(rows, 'issued') };
  }

  // ------------------------------------------------------------------ internals

  /** Posts one entry for a cheque move; returns the journal entry id. */
  private async post(
    tenantId: string,
    cheque: ChequeEntity,
    marker: string,
    date: string,
    title: string,
    lines: PostingLine[],
    manager: EntityManager,
    spentToCode?: string,
  ): Promise<number> {
    const partyAccounts: string[] = [CHEQUE_ACCOUNTS.RECEIVABLES, CHEQUE_ACCOUNTS.PAYABLES];
    const entry = await this.accountingService.createJournalEntry(
      tenantId,
      {
        entryNumber: `CHQ-${cheque.id}-${marker}-${randomUUID().slice(0, 8)}`,
        date: `${date}T00:00:00.000Z`,
        description: `${title} — چک ${cheque.chequeNumber} (${cheque.partyName})`,
        lines: lines.map((line) => ({
          accountCode: line.accountCode,
          debit: minorToDecimal(line.debit),
          credit: minorToDecimal(line.credit),
          // an endorsed cheque settles a different party's payable than the drawer's
          partyCode: !partyAccounts.includes(line.accountCode)
            ? undefined
            : marker === ChequeStatus.SPENT
              ? spentToCode || undefined
              : (cheque.partyCode ?? undefined),
        })),
      },
      manager,
    );
    return entry.id;
  }

  /**
   * Makes sure the cheque accounts exist for the tenant. Checked against the live chart on
   * every call (not cached in process memory) so a chart reset or import cannot leave the
   * service believing accounts exist that do not.
   */
  private async ensureAccounts(tenantId: string): Promise<void> {
    const existing = new Set((await this.accountingService.listAccounts(tenantId)).map((a) => a.code));
    for (const definition of CHEQUE_ACCOUNT_DEFINITIONS) {
      if (existing.has(definition.code)) continue;
      try {
        await this.accountingService.createAccount(tenantId, {
          code: definition.code,
          name: definition.name,
          accountType: definition.accountType as AccountType,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error; // concurrent first use
      }
    }
  }

  private toDto(cheque: ChequeEntity): ChequeResponseDto {
    return {
      id: cheque.id,
      direction: cheque.direction,
      sayadNumber: cheque.sayadNumber,
      sayadVerified: cheque.sayadVerified,
      sayadRegistrationStatus: cheque.sayadRegistrationStatus ?? SayadRegistrationStatus.UNKNOWN,
      sayadVerifiedBy: cheque.sayadVerifiedBy ?? null,
      sayadVerifiedAt: cheque.sayadVerifiedAt ? new Date(cheque.sayadVerifiedAt).toISOString() : null,
      receiverNationalId: cheque.receiverNationalId ?? null,
      chequeNumber: cheque.chequeNumber,
      bankName: cheque.bankName,
      amount: fromMinor(fromDb(cheque.amount)),
      issueDate: cheque.issueDate,
      dueDate: cheque.dueDate,
      partyName: cheque.partyName,
      partyCode: cheque.partyCode,
      spentToName: cheque.spentToName,
      spentToCode: cheque.spentToCode ?? null,
      spentToNationalId: cheque.spentToNationalId ?? null,
      settledAmount: fromMinor(fromDb(cheque.settledAmount ?? '0')),
      remainingAmount: fromMinor(fromDb(cheque.amount) - fromDb(cheque.settledAmount ?? '0')),
      status: cheque.status,
      allowedNext: allowedTargets(cheque.direction, cheque.status),
      description: cheque.description,
    };
  }

  private toEventDto(event: ChequeEventEntity): ChequeEventResponseDto {
    return {
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      eventDate: event.eventDate,
      journalEntryId: event.journalEntryId,
      amount: event.amount === null || event.amount === undefined ? null : fromMinor(fromDb(event.amount)),
      note: event.note,
    };
  }
}
