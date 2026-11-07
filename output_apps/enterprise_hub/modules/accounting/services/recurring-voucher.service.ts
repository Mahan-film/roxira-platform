import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EntityManager } from 'typeorm';
import {
  FREQUENCY_MONTHS,
  RECURRING_VOUCHERS_QUEUE,
  RECURRING_VOUCHER_RUN_JOB,
} from '../constants/recurring-voucher.constants';
import { MIN_JOURNAL_LINES } from '../constants/accounting.constants';
import {
  CreateRecurringVoucherDto,
  RecurringVoucherResponseDto,
  RunRecurringVouchersResultDto,
  UpdateRecurringVoucherDto,
} from '../dto/recurring-voucher.dto';
import { JournalEntryLineDto } from '../dto/create-journal-entry.dto';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { PeriodLockedException } from '../exceptions/ledger.exceptions';
import { MoneyFormatError, minorToDecimal, toMinor } from '../money';
import {
  RecurringVoucherEntity,
  RecurringVoucherLine,
} from '../entities/recurring-voucher.entity';
import { RecurringVoucherRepository } from '../repositories/recurring-voucher.repository';
import { AccountingService } from './accounting.service';
import {
  advanceJalaliMonths,
  firstDayOfNextJalaliMonth,
} from './recurring-voucher.calendar';

/**
 * Recurring voucher templates and the run-due engine (E-04).
 *
 * The engine is idempotent: a run row is inserted before the voucher, and the unique
 * (tenant, recurring, run_date) index makes a second runner's insert a no-op, so two workers can
 * never create the same voucher twice. A locked period rolls the run row back, so the date is
 * retried after the period is unlocked instead of being skipped forever.
 */
@Injectable()
export class RecurringVoucherService implements OnModuleInit {
  private readonly logger = new Logger(RecurringVoucherService.name);

  constructor(
    private readonly repo: RecurringVoucherRepository,
    private readonly accounting: AccountingService,
    @Optional()
    @InjectQueue(RECURRING_VOUCHERS_QUEUE)
    private readonly queue?: Queue,
  ) {}

  /** Registers the daily run-due repeatable job once per process start (skipped in tests). */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !this.queue) return;
    await this.queue
      .add(
        RECURRING_VOUCHER_RUN_JOB,
        {},
        {
          repeat: { every: 24 * 60 * 60 * 1000 },
          jobId: 'recurring-vouchers-daily',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      )
      .catch((error) =>
        this.logger.warn(`recurring voucher schedule failed: ${(error as Error).message}`),
      );
  }

  private toDto(entity: RecurringVoucherEntity): RecurringVoucherResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      lines: entity.lines as JournalEntryLineDto[],
      frequency: entity.frequency,
      nextRunDate: entity.nextRunDate,
      endDate: entity.endDate,
      autoReverse: entity.autoReverse,
      active: entity.active,
      createdBy: entity.createdBy,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /** Exact balance check in integer minor units: debit equals credit and the total is above zero. */
  private assertBalanced(lines: JournalEntryLineDto[]): void {
    if (!Array.isArray(lines) || lines.length < MIN_JOURNAL_LINES) {
      throw new BadRequestException('سند دوره‌ای باید حداقل دو سطر داشته باشد.');
    }
    let debit = 0n;
    let credit = 0n;
    try {
      for (const line of lines) {
        debit += line.debit != null ? toMinor(line.debit) : 0n;
        credit += line.credit != null ? toMinor(line.credit) : 0n;
      }
    } catch (error) {
      if (error instanceof MoneyFormatError) {
        throw new BadRequestException(`مبلغ سطر سند دوره‌ای نامعتبر است: ${error.message}`);
      }
      throw error;
    }
    if (debit !== credit || debit <= 0n) {
      throw new BadRequestException(
        `سند دوره‌ای تراز نیست: جمع بدهکار (${minorToDecimal(debit)}) با جمع بستانکار (${minorToDecimal(credit)}) برابر نیست.`,
      );
    }
  }

  list(tenantId: string): Promise<RecurringVoucherResponseDto[]> {
    return this.repo.list(tenantId).then((rows) => rows.map((row) => this.toDto(row)));
  }

  async findOne(tenantId: string, id: number): Promise<RecurringVoucherResponseDto> {
    const found = await this.repo.findById(tenantId, id);
    if (!found) {
      throw new NotFoundException(`الگوی سند دوره‌ای با شناسه ${id} یافت نشد.`);
    }
    return this.toDto(found);
  }

  async create(
    tenantId: string,
    actor: string,
    dto: CreateRecurringVoucherDto,
  ): Promise<RecurringVoucherResponseDto> {
    this.assertBalanced(dto.lines);
    const created = await this.repo.create(tenantId, {
      name: dto.name.trim(),
      description: dto.description.trim(),
      lines: dto.lines as RecurringVoucherLine[],
      frequency: dto.frequency,
      nextRunDate: dto.nextRunDate,
      endDate: dto.endDate ?? null,
      autoReverse: dto.autoReverse ?? false,
      active: dto.active ?? true,
      createdBy: actor,
    });
    return this.toDto(created);
  }

  async update(
    tenantId: string,
    id: number,
    dto: UpdateRecurringVoucherDto,
  ): Promise<RecurringVoucherResponseDto> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException(`الگوی سند دوره‌ای با شناسه ${id} یافت نشد.`);
    }
    const lines = (dto.lines ?? existing.lines) as JournalEntryLineDto[];
    this.assertBalanced(lines);
    const updated = await this.repo.update(tenantId, id, {
      name: (dto.name ?? existing.name).trim(),
      description: (dto.description ?? existing.description).trim(),
      lines: lines as RecurringVoucherLine[],
      frequency: dto.frequency ?? existing.frequency,
      nextRunDate: dto.nextRunDate ?? existing.nextRunDate,
      endDate: dto.endDate !== undefined ? dto.endDate : existing.endDate,
      autoReverse: dto.autoReverse ?? existing.autoReverse,
      active: dto.active ?? existing.active,
    });
    return this.toDto(updated as RecurringVoucherEntity);
  }

  async remove(tenantId: string, id: number): Promise<void> {
    const removed = await this.repo.remove(tenantId, id);
    if (!removed) {
      throw new NotFoundException(`الگوی سند دوره‌ای با شناسه ${id} یافت نشد.`);
    }
  }

  /** Tenants the daily job must visit; the `tenants` table itself has no RLS. */
  tenantIds(): Promise<string[]> {
    return this.repo.tenantIds();
  }

  /**
   * Posts every template that is due up to `today` (catching up missed periods, oldest first) and
   * then reverses every accrual whose reversal day has arrived. A locked period or closed year is
   * reported in `skipped` and never advances the template past it, so it is retried later.
   */
  async runDue(tenantId: string, today: string): Promise<RunRecurringVouchersResultDto> {
    const result: RunRecurringVouchersResultDto = { created: 0, reversed: 0, skipped: [] };

    const templates = await this.repo.findActiveDue(tenantId, today);
    for (const template of templates) {
      let next = template.nextRunDate;
      while (next <= today && (template.endDate == null || next <= template.endDate)) {
        const outcome = await this.runOne(tenantId, template, next);
        if (outcome === 'locked') {
          result.skipped.push({
            id: template.id,
            date: next,
            reason: 'دورهٔ قفل‌شده یا سال مالی بسته است؛ این سررسید تا بازگشایی قفل به تعویق افتاد.',
          });
          break; // do not advance past the locked date: it must be retried later
        }
        if (outcome === 'created') {
          result.created += 1;
        }
        next = advanceJalaliMonths(next, FREQUENCY_MONTHS[template.frequency]);
        await this.repo.setNextRunDate(tenantId, template.id, next);
      }
    }

    const dueReversals = await this.repo.findDueReversals(tenantId, today);
    for (const run of dueReversals) {
      try {
        const reversal = await this.accounting.reverseJournalEntry(tenantId, run.journalEntryId, {
          date: run.reversalDate,
          reason: `برگشت خودکار سند دوره‌ای #${run.recurringId}`,
        });
        await this.repo.setRunReversalEntry(tenantId, run.id, reversal.id);
        result.reversed += 1;
      } catch (error) {
        if (error instanceof PeriodLockedException) {
          result.skipped.push({
            id: run.recurringId,
            date: run.reversalDate,
            reason: 'دورهٔ برگشت قفل است؛ برگشت بعداً دوباره تلاش می‌شود.',
          });
          continue;
        }
        throw error;
      }
    }

    return result;
  }

  /**
   * One due date: claim the run slot, create the voucher and record it — all in one transaction.
   * A locked period rolls the whole thing back (so the slot is free for a retry) and is reported
   * as 'locked' rather than thrown.
   */
  private async runOne(
    tenantId: string,
    template: RecurringVoucherEntity,
    runDate: string,
  ): Promise<'created' | 'duplicate' | 'locked'> {
    try {
      return await this.repo.transaction(tenantId, async (manager: EntityManager) => {
        const runId = await this.repo.insertRunIfAbsent(tenantId, template.id, runDate, manager);
        if (runId == null) {
          return 'duplicate';
        }
        const entry = await this.accounting.createJournalEntry(
          tenantId,
          {
            entryNumber: `RV-${template.id}-${runDate}`,
            date: runDate,
            description: template.description,
            lines: template.lines as JournalEntryLineDto[],
            status: template.autoReverse ? JournalEntryStatus.POSTED : JournalEntryStatus.DRAFT,
          },
          manager,
        );
        const reversalDate = template.autoReverse ? firstDayOfNextJalaliMonth(runDate) : null;
        await this.repo.attachRunEntry(tenantId, runId, entry.id, reversalDate, manager);
        return 'created';
      });
    } catch (error) {
      if (error instanceof PeriodLockedException) {
        return 'locked';
      }
      throw error;
    }
  }
}
