import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { assertNotAiIdentity } from '../../access/access-context';
import { JournalEntryType } from '../../accounting/enums/accounting.enum';
import {
  formatCurrencyMinor,
  MoneyFormatError,
  parseCurrencyMinor,
} from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import {
  isSupportedCurrency,
  UnsupportedCurrencyError,
} from '../../country_packs/currency-exponents';
import { EffectiveTieOutConfigRegistry } from '../analysis/effective-tie-out-config.registry';
import { ImportTieOutEngine } from '../analysis/import-tie-out.engine';
import {
  CutoverGoLiveRequestDto,
  CutoverGoLiveResponseDto,
  CutoverOpeningLineDto,
  CutoverPreflightRequestDto,
  CutoverPreflightResponseDto,
  CutoverStatusResponseDto,
  isValidCalendarIsoDate,
  VerifyCutoverLockDto,
  VerifyCutoverLockResponseDto,
} from '../dto/cutover-wizard.dto';
import { mapControlTotalsDtoToRecord } from '../dto/package-commit.dto';
import { NormalisedRecord } from '../registry/import-registry.types';
import { CutoverRepository } from '../repositories/cutover.repository';

interface ValidatedOpeningLine {
  accountCode: string;
  description?: string;
  debitMinor: bigint;
  creditMinor: bigint;
}

function dayBefore(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

/**
 * Safe Cutover Wizard (#1217, rebuilt after #1215):
 * - Rejects empty/unverified tie-outs (requires >= 2 valid opening lines + passing TB + control tie-outs).
 * - Checks human non-AI actor BEFORE any DB write.
 * - Executes replay lock + typed OPENING journal + pre-cutover period lock + cutover record in ONE transaction.
 * - Enforces single active cutover per tenant via advisory lock + `findActive` + DB unique partial index.
 * - `verifyPreCutoverLock` is a strict read-only dry check that NEVER writes to the ledger.
 */
@Injectable()
export class CutoverWizardService {
  constructor(
    private readonly tieOutEngine: ImportTieOutEngine,
    private readonly configRegistry: EffectiveTieOutConfigRegistry,
    private readonly accountingService: AccountingService,
    private readonly cutoverRepository: CutoverRepository,
  ) {}

  evaluatePreflight(dto: CutoverPreflightRequestDto): CutoverPreflightResponseDto {
    if (!dto || !isValidCalendarIsoDate(dto.cutoverDate)) {
      throw new BadRequestException('تاریخ کات‌اوور (cutoverDate) نامعتبر است.');
    }
    const currency = (dto.currency ?? 'IRR').trim().toUpperCase();
    if (!isSupportedCurrency(currency)) {
      throw new BadRequestException(`کد ارز پشتیبانی نمی‌شود: "${currency}".`);
    }

    const lines = this.validateOpeningLines(dto.openingBalances, currency);
    const controlTotals = mapControlTotalsDtoToRecord(dto.controlTotals);

    const recordsByEntity = new Map<string, NormalisedRecord[]>();
    recordsByEntity.set(
      'accounting-opening-balances',
      lines.map((l, idx) => ({
        rowNumber: idx + 2,
        values: {
          accountCode: l.accountCode,
          description: l.description ?? '',
          debit: formatCurrencyMinor(l.debitMinor, currency),
          credit: formatCurrencyMinor(l.creditMinor, currency),
        },
      })),
    );
    if (dto.salesInvoices?.length) {
      recordsByEntity.set(
        'sales-invoices',
        dto.salesInvoices.map((v, i) => ({ rowNumber: i + 2, values: v })),
      );
    }
    if (dto.purchaseInvoices?.length) {
      recordsByEntity.set(
        'purchase-invoices',
        dto.purchaseInvoices.map((v, i) => ({ rowNumber: i + 2, values: v })),
      );
    }
    if (dto.inventoryItems?.length) {
      recordsByEntity.set(
        'inventory-items',
        dto.inventoryItems.map((v, i) => ({ rowNumber: i + 2, values: v })),
      );
    }
    if (dto.bankStatements?.length) {
      recordsByEntity.set(
        'bank-statement',
        dto.bankStatements.map((v, i) => ({ rowNumber: i + 2, values: v })),
      );
    }

    const tieOut = this.tieOutEngine.evaluateTieOuts({
      recordsByEntity,
      asOfDate: dto.cutoverDate,
      currency,
      controlTotals,
    });

    const blockersFa = [...tieOut.blockersFa];
    const tb = tieOut.items.find((i) => i.category === 'TRIAL_BALANCE');
    if (tieOut.totalChecks < 1 || !tb || !tb.matched || BigInt(tb.actualMinor) <= 0n) {
      blockersFa.push('حداقل کنترل تراز آزمایشی افتتاحیه (بدهکار = بستانکار > ۰) باید اجرا و تأیید شود.');
    }

    // Fail closed if an AP control account is present in openingBalances without AP subledger or controlTotal.
    const cfg = this.configRegistry.resolveConfig(dto.cutoverDate);
    const hasApAccount = lines.some((l) => cfg.accountsPayable.accountCodes.includes(l.accountCode));
    if (
      hasApAccount &&
      !dto.purchaseInvoices?.length &&
      controlTotals?.ACCOUNTS_PAYABLE === undefined
    ) {
      blockersFa.push(
        'سرفصل حساب‌های پرداختنی (AP) در افتتاحیه وجود دارد اما زیرمعین یا مبلغ کنترل AP برای مغایرت‌گیری ارسال نشده است.',
      );
    }

    return {
      passed: tieOut.passed && blockersFa.length === 0,
      cutoverDate: dto.cutoverDate,
      currency,
      checksRun: tieOut.totalChecks,
      blockersFa,
      tieOut,
    };
  }

  async executeGoLive(
    tenantId: string,
    actorId: string | undefined,
    dto: CutoverGoLiveRequestDto,
  ): Promise<CutoverGoLiveResponseDto> {
    const cleanActor = actorId?.trim();
    if (!cleanActor) {
      throw new ForbiddenException('شناسه کاربر احراز هویت‌شده برای اجرای کات‌اوور الزامی است.');
    }
    // Check AI identity BEFORE any write or transaction so no orphan journal can ever be posted.
    assertNotAiIdentity(cleanActor, 'execute cutover go-live');

    if (!dto || !isValidCalendarIsoDate(dto.cutoverDate)) {
      throw new BadRequestException('تاریخ کات‌اوور (cutoverDate) نامعتبر است.');
    }
    const preCutoverLockDate = dto.preCutoverLockDate ?? dayBefore(dto.cutoverDate);
    if (!isValidCalendarIsoDate(preCutoverLockDate)) {
      throw new BadRequestException('تاریخ قفل دوره پیش از کات‌اوور (preCutoverLockDate) نامعتبر است.');
    }
    if (preCutoverLockDate >= dto.cutoverDate) {
      throw new BadRequestException(
        'تاریخ قفل پیش از کات‌اوور (preCutoverLockDate) باید اکیداً قبل از تاریخ کات‌اوور (cutoverDate) باشد.',
      );
    }

    const currency = (dto.currency ?? 'IRR').trim().toUpperCase();
    const lines = this.validateOpeningLines(dto.openingBalances, currency);
    const preflight = this.evaluatePreflight(dto);
    if (!preflight.passed) {
      throw new BadRequestException({
        code: 'CUTOVER_TIE_OUT_BLOCKED',
        message: 'اجرای کات‌اوور به دلیل عدم تطابق کنترل‌های افتتاحیه مسدود شد.',
        preflight,
      });
    }

    const legacyNumberPrefix = (dto.legacyNumberPrefix ?? 'LEGACY-').trim();
    const entryNumber = `OB-CUTOVER-${dto.cutoverDate}`;
    const entryDescription =
      dto.description?.trim() || `سند افتتاحیه کات‌اوور (${dto.cutoverDate})`;

    return this.cutoverRepository.runInTenantTransaction(tenantId, async (manager) => {
      await this.cutoverRepository.acquireTenantCutoverLock(tenantId, manager);
      const existing = await this.cutoverRepository.findActive(tenantId, manager);
      if (existing) {
        throw new ConflictException(
          `کات‌اوور برای این سازمان قبلاً در تاریخ ${existing.cutoverDate} ثبت و فعال شده است.`,
        );
      }

      const openingEntry = await this.accountingService.postTypedEntry(
        tenantId,
        {
          entryNumber,
          date: `${dto.cutoverDate}T00:00:00.000Z`,
          description: entryDescription,
          lines: lines.map((l) => ({
            accountCode: l.accountCode,
            debit: formatCurrencyMinor(l.debitMinor, currency),
            credit: formatCurrencyMinor(l.creditMinor, currency),
            description: l.description,
          })),
        },
        JournalEntryType.OPENING,
        manager,
      );

      const periodLock = await this.accountingService.lockPeriod(
        tenantId,
        cleanActor,
        {
          periodStart: '1970-01-01',
          periodEnd: preCutoverLockDate,
          reason: `Pre-cutover period lock (cutover ${dto.cutoverDate})`,
        },
        manager,
      );

      const cutover = await this.cutoverRepository.createCutover(
        tenantId,
        {
          cutoverDate: dto.cutoverDate,
          preCutoverLockDate,
          periodLockId: periodLock.id,
          openingJournalEntryId: openingEntry.id,
          legacyNumberPrefix,
          executedBy: cleanActor,
          metadata: { currency, checksRun: preflight.checksRun },
        },
        manager,
      );

      return {
        cutoverId: cutover.id,
        cutoverDate: cutover.cutoverDate,
        preCutoverLockDate: cutover.preCutoverLockDate,
        openingJournalEntryId: openingEntry.id,
        openingEntryNumber: openingEntry.entryNumber,
        periodLockId: periodLock.id,
        legacyNumberPrefix: cutover.legacyNumberPrefix,
        executedBy: cleanActor,
      };
    });
  }

  /**
   * Read-only dry check verifying whether `testDate` is covered by an active period lock.
   * NEVER writes a journal entry or mutates ledger state.
   */
  async verifyPreCutoverLock(
    tenantId: string,
    dto: VerifyCutoverLockDto,
  ): Promise<VerifyCutoverLockResponseDto> {
    if (!dto || !isValidCalendarIsoDate(dto.testDate)) {
      throw new BadRequestException('تاریخ آزمون قفل دوره (testDate) باید یک تاریخ معتبر YYYY-MM-DD باشد.');
    }
    const [locked, active] = await Promise.all([
      this.accountingService.isPeriodLocked(tenantId, new Date(`${dto.testDate}T00:00:00.000Z`)),
      this.cutoverRepository.findActive(tenantId),
    ]);
    return {
      locked,
      dryCheck: true,
      testDate: dto.testDate,
      activeCutoverId: active?.id ?? null,
      preCutoverLockDate: active?.preCutoverLockDate ?? null,
      periodLockId: active?.periodLockId ?? null,
    };
  }

  async getStatus(tenantId: string): Promise<CutoverStatusResponseDto> {
    const active = await this.cutoverRepository.findActive(tenantId);
    if (!active) {
      return {
        active: false,
        cutoverId: null,
        cutoverDate: null,
        preCutoverLockDate: null,
        openingJournalEntryId: null,
        periodLockId: null,
        legacyNumberPrefix: null,
        executedBy: null,
      };
    }
    return {
      active: true,
      cutoverId: active.id,
      cutoverDate: active.cutoverDate,
      preCutoverLockDate: active.preCutoverLockDate,
      openingJournalEntryId: active.openingJournalEntryId ?? null,
      periodLockId: active.periodLockId,
      legacyNumberPrefix: active.legacyNumberPrefix,
      executedBy: active.executedBy ?? null,
    };
  }

  /** Preserve historical imported document numbers in a separate legacy series without renumbering. */
  formatLegacyDocumentNumber(prefix: string, originalNumber: string): string {
    const cleanPrefix = (prefix || 'LEGACY-').trim();
    const cleanNum = originalNumber.trim();
    if (!cleanNum) {
      throw new BadRequestException('شماره سند موروثی نمی‌تواند خالی باشد.');
    }
    return cleanNum.startsWith(cleanPrefix) ? cleanNum : `${cleanPrefix}${cleanNum}`;
  }

  private validateOpeningLines(
    rawLines: CutoverOpeningLineDto[] | undefined,
    currency: string,
  ): ValidatedOpeningLine[] {
    if (!Array.isArray(rawLines) || rawLines.length < 2) {
      throw new BadRequestException(
        'حداقل دو سطر مانده افتتاحیه معتبر برای ارزیابی و ثبت سند افتتاحیه الزامی است.',
      );
    }
    return rawLines.map((line, index) => {
      const accountCode = typeof line?.accountCode === 'string' ? line.accountCode.trim() : '';
      if (!accountCode) {
        throw new BadRequestException(`سطر ${index + 1}: کد حساب الزامی است.`);
      }
      const debitMinor = this.parseNonNegativeLineAmount(line.debit, currency, index + 1, 'بدهکار');
      const creditMinor = this.parseNonNegativeLineAmount(line.credit, currency, index + 1, 'بستانکار');
      if (debitMinor > 0n && creditMinor > 0n) {
        throw new BadRequestException(
          `سطر ${index + 1} (${accountCode}): هر سطر فقط می‌تواند بدهکار یا بستانکار باشد، نه هر دو.`,
        );
      }
      if (debitMinor === 0n && creditMinor === 0n) {
        throw new BadRequestException(
          `سطر ${index + 1} (${accountCode}): مبلغ بدهکار یا بستانکار باید بزرگ‌تر از صفر باشد.`,
        );
      }
      return {
        accountCode,
        description: line.description?.trim(),
        debitMinor,
        creditMinor,
      };
    });
  }

  private parseNonNegativeLineAmount(
    raw: string | number | undefined,
    currency: string,
    rowNum: number,
    labelFa: string,
  ): bigint {
    if (raw === undefined || raw === null || raw === '') {
      return 0n;
    }
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      throw new BadRequestException(`سطر ${rowNum}: مقدار ${labelFa} نامعتبر است.`);
    }
    try {
      const minor = parseCurrencyMinor(raw, currency);
      if (minor < 0n) {
        throw new BadRequestException(`سطر ${rowNum}: مبلغ ${labelFa} نمی‌تواند منفی باشد.`);
      }
      return minor;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof MoneyFormatError || error instanceof UnsupportedCurrencyError) {
        throw new BadRequestException(`سطر ${rowNum} (${labelFa}): ${error.message}`);
      }
      throw error;
    }
  }
}
