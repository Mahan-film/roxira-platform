import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { CalendarService } from '../../calendar';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import { JournalEntryEntity } from '../entities/journal-entry.entity';
import {
  AccountingPeriodState,
  JournalEntryStatus,
  PeriodCalendarType,
} from '../enums/accounting.enum';
import { PeriodStateLockedException } from '../exceptions/ledger.exceptions';

export interface CreateAccountingPeriodInput {
  code: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  fiscalYearId?: number | null;
  calendarType?: PeriodCalendarType;
  isAdjustment?: boolean;
  allowedRoles?: string[];
}

export interface SoftLockPeriodInput {
  allowedRoles?: string[];
  reason?: string;
}

export interface HardClosePeriodInput {
  reason?: string;
}

/**
 * Manages accounting period states (OPEN, SOFT_LOCKED, ADJUSTMENT, HARD_CLOSED)
 * and calendar-aware period cut-offs (Gregorian & Jalali) (T178).
 */
@Injectable()
export class AccountingPeriodService {
  constructor(
    private readonly scope: TenantScope,
    private readonly calendar: CalendarService,
  ) {}

  async listPeriods(tenantId: string): Promise<AccountingPeriodEntity[]> {
    return this.scope.within(tenantId, undefined, async (m) => {
      return m.getRepository(AccountingPeriodEntity).find({
        where: { tenantId },
        order: { periodStart: 'ASC', isAdjustment: 'ASC', id: 'ASC' },
      });
    });
  }

  async createPeriod(
    tenantId: string,
    input: CreateAccountingPeriodInput,
  ): Promise<AccountingPeriodEntity> {
    if (new Date(input.periodStart) > new Date(input.periodEnd)) {
      throw new BadRequestException('periodStart must not be after periodEnd.');
    }
    return this.scope.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(AccountingPeriodEntity);
      const existing = await repo.findOne({ where: { tenantId, code: input.code.trim() } });
      if (existing) {
        throw new ConflictException(`Accounting period ${input.code} already exists.`);
      }
      const isAdj = input.isAdjustment ?? false;
      const entity = repo.create({
        tenantId,
        fiscalYearId: input.fiscalYearId ?? null,
        code: input.code.trim(),
        name: input.name.trim(),
        calendarType: input.calendarType ?? PeriodCalendarType.GREGORIAN,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        isAdjustment: isAdj,
        state: isAdj ? AccountingPeriodState.ADJUSTMENT : AccountingPeriodState.OPEN,
        allowedRoles: input.allowedRoles ?? [],
      });
      return repo.save(entity);
    });
  }

  /**
   * Generates the 12 Jalali month periods for a Jalali year using CalendarService.fiscalMonths,
   * so Jalali entity cut-offs follow exact Jalali month ends (29/30/31 days, leap years).
   */
  async createJalaliYearPeriods(
    tenantId: string,
    jalaliYear: number,
    fiscalYearId?: number | null,
  ): Promise<AccountingPeriodEntity[]> {
    const months = this.calendar.fiscalMonths(this.calendar.iranFiscalYear, jalaliYear);
    const created: AccountingPeriodEntity[] = [];
    for (const m of months) {
      const monthStr = String(m.index).padStart(2, '0');
      const code = `${jalaliYear}-${monthStr}`;
      const period = await this.createPeriod(tenantId, {
        code,
        name: `دوره ${code}`,
        periodStart: m.startDate,
        periodEnd: m.endDate,
        fiscalYearId: fiscalYearId ?? null,
        calendarType: PeriodCalendarType.JALALI,
      });
      created.push(period);
    }
    return created;
  }

  async softLockPeriod(
    tenantId: string,
    periodId: number,
    actor: string,
    input: SoftLockPeriodInput,
  ): Promise<AccountingPeriodEntity> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(AccountingPeriodEntity);
      const period = await repo.findOne({ where: { id: periodId, tenantId } });
      if (!period) {
        throw new NotFoundException(`Accounting period ${periodId} not found.`);
      }
      if (period.state === AccountingPeriodState.HARD_CLOSED) {
        throw new ConflictException(`Period ${period.code} is hard-closed and cannot be modified.`);
      }
      period.state = AccountingPeriodState.SOFT_LOCKED;
      period.allowedRoles = input.allowedRoles ?? [];
      period.lockedBy = actor;
      period.lockedAt = new Date();
      period.lockReason = input.reason?.trim() || null;
      return repo.save(period);
    });
  }

  /**
   * Hard-closes a period irreversibly.
   * Refuses if any DRAFT or TEMPORARY journal entries exist in [periodStart, periodEnd],
   * naming the unposted entries in the error message.
   */
  async hardClosePeriod(
    tenantId: string,
    periodId: number,
    actor: string,
    input: HardClosePeriodInput = {},
  ): Promise<AccountingPeriodEntity> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(AccountingPeriodEntity);
      const period = await repo.findOne({ where: { id: periodId, tenantId } });
      if (!period) {
        throw new NotFoundException(`Accounting period ${periodId} not found.`);
      }
      if (period.state === AccountingPeriodState.HARD_CLOSED) {
        throw new ConflictException(`Period ${period.code} is already hard-closed.`);
      }

      const unposted: Array<{ id: number; entry_number: string; status: string }> = await m.query(
        `SELECT "id", "entry_number", "status"
           FROM "fin_journal_entries"
          WHERE "tenant_id" = $1
            AND "status" IN ($2, $3)
            AND CAST("date" AS date) BETWEEN $4::date AND $5::date
          ORDER BY "id" ASC`,
        [
          tenantId,
          JournalEntryStatus.DRAFT,
          JournalEntryStatus.TEMPORARY,
          period.periodStart,
          period.periodEnd,
        ],
      );
      if (unposted.length > 0) {
        const names = unposted.map((u) => u.entry_number).join(', ');
        throw new ConflictException(
          `Cannot hard-close period ${period.code} while unposted entries exist: ${names}`,
        );
      }

      period.state = AccountingPeriodState.HARD_CLOSED;
      period.hardClosedBy = actor;
      period.hardClosedAt = new Date();
      period.hardCloseReason = input.reason?.trim() || null;
      return repo.save(period);
    });
  }

  async unlockPeriod(
    tenantId: string,
    periodId: number,
  ): Promise<AccountingPeriodEntity> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(AccountingPeriodEntity);
      const period = await repo.findOne({ where: { id: periodId, tenantId } });
      if (!period) {
        throw new NotFoundException(`Accounting period ${periodId} not found.`);
      }
      if (period.state === AccountingPeriodState.HARD_CLOSED) {
        throw new ConflictException(
          `Period ${period.code} is hard-closed and cannot be unlocked; post corrections to the next open period or an adjustment period.`,
        );
      }
      period.state = period.isAdjustment ? AccountingPeriodState.ADJUSTMENT : AccountingPeriodState.OPEN;
      period.allowedRoles = [];
      period.lockedBy = null;
      period.lockedAt = null;
      period.lockReason = null;
      return repo.save(period);
    });
  }

  /**
   * Checks whether posting is allowed on `date` (or into `accountingPeriodId`) for `actorRole`.
   * Throws HTTP 422 `PERIOD_LOCKED` when blocked by SOFT_LOCKED (without exception) or HARD_CLOSED.
   */
  async assertPostingAllowed(
    tenantId: string,
    date: Date,
    options: { actorRole?: string; accountingPeriodId?: number | null } = {},
    manager?: EntityManager,
  ): Promise<void> {
    await this.scope.within(tenantId, manager, async (m) => {
      const repo = m.getRepository(AccountingPeriodEntity);

      if (options.accountingPeriodId != null) {
        const explicit = await repo.findOne({
          where: { id: options.accountingPeriodId, tenantId },
        });
        if (!explicit) {
          throw new NotFoundException(`Accounting period ${options.accountingPeriodId} not found.`);
        }
        this.enforcePeriodAccess(explicit, options.actorRole);
        return;
      }

      const day = date.toISOString().slice(0, 10);
      const covering = await repo
        .createQueryBuilder('p')
        .where('p.tenantId = :tenantId', { tenantId })
        .andWhere('p.isAdjustment = false')
        .andWhere(':day::date BETWEEN p.periodStart::date AND p.periodEnd::date', { day })
        .orderBy('p.id', 'ASC')
        .getMany();

      for (const period of covering) {
        this.enforcePeriodAccess(period, options.actorRole);
      }
    });
  }

  private enforcePeriodAccess(period: AccountingPeriodEntity, actorRole?: string): void {
    if (period.state === AccountingPeriodState.HARD_CLOSED) {
      throw new PeriodStateLockedException(
        `Period ${period.code} is hard-closed; corrections must be posted to an open period or an adjustment period.`,
      );
    }
    if (period.state === AccountingPeriodState.SOFT_LOCKED) {
      const role = actorRole?.trim();
      if (!role || !period.allowedRoles.includes(role)) {
        throw new PeriodStateLockedException(
          `Period ${period.code} is soft-locked; role ${role ?? 'unknown'} is not permitted to post.`,
        );
      }
    }
    if (period.state === AccountingPeriodState.ADJUSTMENT) {
      const allowed = period.allowedRoles && period.allowedRoles.length > 0
        ? period.allowedRoles
        : ['chief-accountant', 'partner-advisor', 'auditor'];
      const role = actorRole?.trim();
      if (!role || !allowed.includes(role)) {
        throw new PeriodStateLockedException(
          `Adjustment period ${period.code} requires an authorised role (${allowed.join(', ')}).`,
        );
      }
    }
  }
}
