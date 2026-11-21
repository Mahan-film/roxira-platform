import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { parseCurrencyMinor } from '../../accounting/money';
import { PeriodLockedException } from '../../accounting/exceptions/ledger.exceptions';
import { AccountingService } from '../../accounting/services/accounting.service';
import { ImportTieOutEngine, parseMoneyValue } from '../analysis/import-tie-out.engine';
import {
  CutoverGoLiveRequestDto,
  CutoverGoLiveResponseDto,
  CutoverPreflightRequestDto,
  CutoverPreflightResponseDto,
  CutoverStatusResponseDto,
  VerifyCutoverLockDto,
  VerifyCutoverLockResponseDto,
} from '../dto/cutover-wizard.dto';
import { mapControlTotalsDtoToRecord } from '../dto/package-commit.dto';
import { NormalisedRecord } from '../registry/import-registry.types';
import { CutoverRepository } from '../repositories/cutover.repository';

/**
 * سرویس راهنمای کات‌اوور و ورود به عملیات زنده (Cutover Wizard Service - R32 D4/D5).
 *
 * مسئولیت‌ها:
 * ۱. ارزیابی تطبیق‌های تراز (TB, AR, AP, Stock, Bank) و مسدودسازی قطعی ورود به عملیات زنده تا سبز شدن ۱۰۰٪ تطبیق‌ها.
 * ۲. ثبت و نشانه‌گذاری سند افتتاحیه در تاریخ شروع عملیات زنده (`cutoverDate`).
 * ۳. قفل قطعی دوره حسابداری پیش از کات‌اوور (از 1970-01-01 تا یک روز پیش از کات‌اوور).
 * ۴. راستی‌آزمایی قفل دوره با آزمایش تلاش ثبت سند و دریافت اجباری `PeriodLockedException`.
 * ۵. حفظ شماره‌های اصلی اسناد و صورتحساب‌های موروثی در یک سری مجزا (`LEGACY-...`) و جلوگیری از تخصیص شماره‌های قطعی جدید بدون شکاف به آن‌ها.
 */
@Injectable()
export class CutoverWizardService {
  private readonly logger = new Logger(CutoverWizardService.name);

  constructor(
    private readonly tieOutEngine: ImportTieOutEngine,
    private readonly accountingService: AccountingService,
    private readonly cutoverRepository: CutoverRepository,
  ) {}

  /**
   * ارزیابی پیش‌پرواز کات‌اوور و تطبیق‌های تراز.
   * در صورت وجود هرگونه مغایرت، `allGreen` و `canGoLive` برابر `false` خواهند بود.
   */
  async evaluatePreflight(
    tenantId: string,
    options: CutoverPreflightRequestDto,
  ): Promise<CutoverPreflightResponseDto> {
    const recordsByEntity = new Map<string, NormalisedRecord[]>();

    if (options.openingBalances && options.openingBalances.length > 0) {
      const records: NormalisedRecord[] = options.openingBalances.map(
        (line, idx) => ({
          sourceSystem: 'cutover-wizard',
          entityKey: 'accounting-opening-balances',
          naturalKey: line.accountCode,
          rowNumber: idx + 1,
          values: {
            accountCode: line.accountCode,
            debit: line.debit ?? 0,
            credit: line.credit ?? 0,
            description: line.description ?? 'مانده افتتاحیه کات‌اوور',
          },
        }),
      );
      recordsByEntity.set('accounting-opening-balances', records);
    }

    const summary = this.tieOutEngine.evaluateTieOuts({
      recordsByEntity,
      asOfDate: options.cutoverDate,
      controlTotals: mapControlTotalsDtoToRecord(options.controlTotals),
    });

    const allGreen = summary.passed;
    return {
      allGreen,
      canGoLive: allGreen,
      items: summary.items,
      discrepancies: summary.discrepancies,
      blockersFa: summary.blockersFa,
    };
  }

  /**
   * اجرای نهایی کات‌اوور و ورود به عملیات زنده (Go-Live).
   *
   * قانون طلایی R32 D4: اگر تطبیق‌ها سبز نباشند، عملیات با خطای `BadRequestException` مسدود می‌شود.
   * پس از تأیید، سند افتتاحیه ثبت شده و دوره ماقبل کات‌اوور تا `preCutoverLockDate` قفل می‌شود.
   */
  async executeGoLive(
    tenantId: string,
    actor: string,
    dto: CutoverGoLiveRequestDto,
  ): Promise<CutoverGoLiveResponseDto> {
    // ۱. بررسی قطعی پیش‌پرواز و ترازها (Gatekeeper)
    const preflight = await this.evaluatePreflight(tenantId, {
      cutoverDate: dto.cutoverDate,
      preCutoverLockDate: dto.preCutoverLockDate,
      controlTotals: dto.controlTotals,
      openingBalances: dto.openingBalances,
    });

    if (!preflight.allGreen) {
      const details =
        preflight.blockersFa.length > 0
          ? preflight.blockersFa.join(' | ')
          : 'مغایرت در ارقام کنترلی ترازهای افتتاحیه';
      this.logger.warn(
        `Cutover go-live blocked for tenant ${tenantId}: ${details}`,
      );
      throw new BadRequestException(
        `ورود به عملیات زنده مسدود شد: مغایرت‌های تطبیق تراز برطرف نشده‌اند (${details}). کات‌اوور تنها با تطبیق ۱۰۰٪ سبز مجاز است.`,
      );
    }

    // ۲. محاسبه تاریخ قفل ماقبل کات‌اوور (یک روز قبل از Go-Live)
    const cutoverD = new Date(`${dto.cutoverDate}T00:00:00.000Z`);
    cutoverD.setUTCDate(cutoverD.getUTCDate() - 1);
    const preCutoverLockDate =
      dto.preCutoverLockDate ?? cutoverD.toISOString().slice(0, 10);

    const legacyPrefix = (dto.legacyNumberPrefix?.trim() || 'LEGACY-').toUpperCase();

    // ۳. ثبت سند افتتاحیه در صورت وجود سطرها
    let openingJournalEntryId: number | undefined = undefined;
    if (dto.openingBalances && dto.openingBalances.length > 0) {
      const entry = await this.accountingService.createJournalEntry(tenantId, {
        entryNumber: `OB-${dto.cutoverDate.replace(/-/g, '')}`,
        date: dto.cutoverDate,
        description: 'سند افتتاحیه انتقال سیستم (Cutover Opening Journal)',
        lines: dto.openingBalances.map((b) => ({
          accountCode: b.accountCode,
          debit: b.debit ? parseMoneyValue(b.debit).toString() : '0',
          credit: b.credit ? parseMoneyValue(b.credit).toString() : '0',
          description: b.description ?? 'مانده افتتاحیه انتقال سیستم (Cutover Opening)',
        })),
      });
      openingJournalEntryId = entry.id;
    }

    // ۴. قفل قطعی دوره حسابداری پیش از کات‌اوور (R32 D5)
    const periodLock = await this.accountingService.lockPeriod(
      tenantId,
      actor,
      {
        periodStart: '1970-01-01',
        periodEnd: preCutoverLockDate,
        reason: 'قفل قطعی دوره پیش از کات‌اوور و شروع عملیات زنده (Cutover Period Lock)',
      },
    );

    // ۵. ثبت سابقه کات‌اوور فعال در مخزن داده
    const cutover = await this.cutoverRepository.createCutover(tenantId, {
      cutoverDate: dto.cutoverDate,
      preCutoverLockDate,
      periodLockId: periodLock.id,
      openingJournalEntryId: openingJournalEntryId ?? null,
      legacyNumberPrefix: legacyPrefix,
      isGoLiveActive: true,
      metadata: {
        actor,
        totalChecks: preflight.items.length,
        discrepanciesCount: preflight.discrepancies.length,
      },
    });

    this.logger.log(
      `Cutover completed successfully for tenant ${tenantId}. Period locked up to ${preCutoverLockDate}.`,
    );

    return {
      status: 'completed',
      isGoLiveActive: true,
      cutoverDate: cutover.cutoverDate,
      preCutoverLockDate: cutover.preCutoverLockDate,
      periodLockId: cutover.periodLockId,
      openingJournalEntryId: cutover.openingJournalEntryId ?? undefined,
      legacyNumberPrefix: cutover.legacyNumberPrefix,
      tieOutSummary: {
        passed: preflight.allGreen,
        totalChecks: preflight.items.length,
        passedChecks: preflight.items.filter((i) => i.matched).length,
        discrepanciesCount: preflight.discrepancies.length,
        items: preflight.items,
        discrepancies: preflight.discrepancies,
        blockersFa: preflight.blockersFa,
      },
    };
  }

  /**
   * راستی‌آزمایی قفل دوره پیش از کات‌اوور با تلاش ثبت سند (R32 Done When).
   *
   * آزمون سند در تاریخ قفل‌شده ارسال می‌شود؛ رد قطعی سند با `PeriodLockedException`
   * اثبات می‌کند که هیچ سندی پس از کات‌اوور نمی‌تواند در دوره ماقبل ثبت شود.
   */
  async verifyPeriodLockPostingAttempt(
    tenantId: string,
    dto?: VerifyCutoverLockDto,
  ): Promise<VerifyCutoverLockResponseDto> {
    const activeCutover = await this.cutoverRepository.findActive(tenantId);
    const targetDate =
      dto?.attemptDate ?? activeCutover?.preCutoverLockDate ?? '2026-03-20';

    try {
      await this.accountingService.createJournalEntry(tenantId, {
        entryNumber: `TEST-LOCK-VERIFY-${Date.now()}`,
        date: targetDate,
        description: 'آزمون راستی‌آزمایی قفل دوره پیش از کات‌اوور',
        lines: [
          { accountCode: '1010', debit: 1000, credit: 0, description: 'آزمون قفل' },
          { accountCode: '2010', debit: 0, credit: 1000, description: 'آزمون قفل' },
        ],
      });

      // در صورتی که خطا پرتاب نشود، قفل دوره کار نکرده است!
      throw new BadRequestException(
        'نقض امنیت: قفل دوره فعال نیست و سند در دوره ماقبل کات‌اوور با موفقیت ثبت شد!',
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (
        error instanceof PeriodLockedException ||
        (error as { name?: string })?.name === 'PeriodLockedException' ||
        (error as { response?: { message?: string } })?.response?.message?.includes('locked') ||
        (error as { message?: string })?.message?.includes('LockedPeriod') ||
        (error as { message?: string })?.message?.includes('قفل شده')
      ) {
        return {
          verified: true,
          errorType: 'PeriodLockedException',
          message:
            'تلاش ثبت سند در دوره پیش از کات‌اوور با موفقیت توسط سیستم قفل دوره مسدود شد (PeriodLockedException).',
        };
      }
      throw error;
    }
  }

  /**
   * قالب‌بندی و اعتبارسنجی شماره اسناد موروثی واردشده قبل از کات‌اوور (R32 D5 & R23).
   * تضمین می‌کند که اسناد قدیمی در سری مجزا قرار می‌گیرند و هرگز شماره ترتیبی جدید دریافت نمی‌کنند.
   */
  formatLegacyDocumentNumber(
    originalNumber: string,
    prefix: string = 'LEGACY-',
  ): string {
    const cleanOriginal = String(originalNumber ?? '').trim();
    if (!cleanOriginal) {
      return `${prefix}${Date.now()}`;
    }
    if (cleanOriginal.toUpperCase().startsWith(prefix.toUpperCase())) {
      return cleanOriginal;
    }
    return `${prefix}${cleanOriginal}`;
  }

  /**
   * دریافت وضعیت فعلی کات‌اوور مستأجر.
   */
  async getCutoverStatus(tenantId: string): Promise<CutoverStatusResponseDto> {
    const active = await this.cutoverRepository.findActive(tenantId);
    if (!active) {
      return {
        isGoLiveActive: false,
      };
    }

    return {
      isGoLiveActive: active.isGoLiveActive,
      cutoverDate: active.cutoverDate,
      preCutoverLockDate: active.preCutoverLockDate,
      periodLockId: active.periodLockId,
      legacyNumberPrefix: active.legacyNumberPrefix,
    };
  }
}
