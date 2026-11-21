import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MoneyFormatError, fromDb, minorToDecimal, toMinor } from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import { BankingService } from '../../banking/services/banking.service';
import { InvoiceDirection } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import {
  BankStatementLineResponseDto,
  ConfirmStatementMatchDto,
  ImportBankStatementDto,
  ImportBankStatementResponseDto,
  QueryBankStatementLinesDto,
  StatementMatchResponseDto,
  StatementSettingsResponseDto,
  StatementSuggestionResponseDto,
} from '../dto/bank-statement.dto';
import {
  BankStatementRepository,
  StatementLineRow,
  StatementMatchRow,
} from '../repositories/bank-statement.repository';
import { TreasuryRepository } from '../repositories/treasury.repository';
import { parseStatement } from '../statement/statement-parse';
import { MatchSuggestion, OpenInvoice, suggestMatch } from '../statement/statement-matcher';
import { StatementParseError } from '../statement/statement.types';

const MAX_INVOICE_PAGES = 20;
const INVOICE_PAGE_SIZE = 100;

interface InvoiceFacts extends OpenInvoice {
  partyCode: string | null;
}

interface MatchPlan {
  rule: 'reference' | 'amount_date' | 'manual';
  auto: boolean;
  feeMinor: bigint;
  allocations: Array<{ invoiceId: string; amountMinor: bigint }>;
  explanation: string;
  note?: string;
}

const compact = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, '').toUpperCase();

function minorOf(value: number | string, label: string): bigint {
  try {
    return toMinor(value);
  } catch (error) {
    if (error instanceof MoneyFormatError) throw new BadRequestException(`${label}: ${error.message}`);
    throw error;
  }
}

/**
 * T184: statement import and reconciliation. A file is parsed (CAMT.053 or MT940), every booked
 * line is stored once per (tenant, bank account, bank transaction id), and credits are matched to
 * open sales invoices by `statement-matcher.ts`. One confirmation posts ONE voucher for the whole
 * payout: debit bank (the amount received), debit bank fees (any fee withheld), credit receivable
 * once per invoice. Accounts come from posting roles (`bank` = the bank account's ledger account,
 * `receivable`, `bank_fee`), never from hard-coded codes.
 */
@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);

  constructor(
    private readonly repository: BankStatementRepository,
    private readonly treasuryRepository: TreasuryRepository,
    private readonly banking: BankingService,
    private readonly invoicing: InvoicingService,
    private readonly accounting: AccountingService,
    private readonly postingRules: PostingRulesService,
  ) {}

  // ------------------------------------------------------------------ import

  async importStatement(tenantId: string, userId: string, dto: ImportBankStatementDto): Promise<ImportBankStatementResponseDto> {
    const accounts = await this.banking.listAccounts(tenantId);
    const account = accounts.find((a) => a.id === dto.bankAccountId);
    if (!account) throw new NotFoundException('حساب بانکی یافت نشد.');

    let parsed;
    try {
      parsed = parseStatement(dto.content, dto.format);
    } catch (error) {
      if (error instanceof StatementParseError) throw new BadRequestException(`فایل صورتحساب معتبر نیست: ${error.message}`);
      throw error;
    }
    if (parsed.lines.length === 0) throw new BadRequestException('فایل صورتحساب هیچ تراکنش قطعی‌شده‌ای ندارد.');

    const known = [compact(account.iban), compact(account.accountNumber)].filter(Boolean);
    if (parsed.accountRef && known.length > 0 && !known.includes(compact(parsed.accountRef))) {
      throw new BadRequestException('شمارهٔ حساب داخل فایل با حساب بانکی انتخاب‌شده یکی نیست.');
    }
    const mismatch = parsed.lines.find((l) => l.currency && account.currency && l.currency !== account.currency);
    if (mismatch) throw new BadRequestException(`ارز فایل (${mismatch.currency}) با ارز حساب بانکی (${account.currency}) یکی نیست.`);

    const fileHash = createHash('sha256').update(dto.content).digest('hex');
    const inserted = await this.repository.runInTransaction(tenantId, async (manager) => {
      const importId = await this.repository.createImport(
        tenantId,
        {
          bankAccountId: account.id,
          format: parsed.format,
          statementId: parsed.statementId,
          accountRef: parsed.accountRef,
          fileHash,
          lineCount: parsed.lines.length,
          importedBy: userId,
        },
        manager,
      );
      const rows = await this.repository.insertNewLines(tenantId, account.id, importId, parsed.lines, manager);
      await this.repository.setImportNewCount(tenantId, importId, rows.length, manager);
      return { importId, rows };
    });

    let autoMatched = 0;
    // an import never posts by itself unless the tenant switched exact-match auto-posting on (default off)
    if (await this.repository.getAutoPost(tenantId)) {
      const credits = inserted.rows.filter((r) => r.direction === 'credit');
      if (credits.length > 0) {
        const open = await this.loadOpenInvoices(tenantId);
        for (const row of credits) {
          const suggestion = suggestMatch(this.matchable(row), [...open.values()]);
          if (!suggestion?.auto) continue;
          try {
            await this.post(tenantId, userId, row, this.planOf(suggestion), true);
            for (const a of suggestion.allocations) {
              const inv = open.get(a.invoiceId);
              if (inv) inv.outstanding -= a.amountMinor;
            }
            autoMatched += 1;
          } catch (error) {
            // the line stays unmatched and shows up in the list for a person
            this.logger.warn(`auto-match of statement line ${row.id} skipped: ${(error as Error).message}`);
          }
        }
      }
    }
    return {
      importId: inserted.importId,
      format: parsed.format,
      totalLines: parsed.lines.length,
      newLines: inserted.rows.length,
      duplicateLines: parsed.lines.length - inserted.rows.length,
      autoMatched,
    };
  }

  // ------------------------------------------------------------------ settings

  async getSettings(tenantId: string): Promise<StatementSettingsResponseDto> {
    return { autoPostExactMatches: await this.repository.getAutoPost(tenantId) };
  }

  async setSettings(tenantId: string, autoPostExactMatches: boolean): Promise<StatementSettingsResponseDto> {
    await this.repository.setAutoPost(tenantId, autoPostExactMatches);
    return this.getSettings(tenantId);
  }

  // ------------------------------------------------------------------ list

  async listLines(tenantId: string, query: QueryBankStatementLinesDto): Promise<BankStatementLineResponseDto[]> {
    const rows = await this.repository.listLines(tenantId, {
      bankAccountId: query.bankAccountId,
      status: query.status,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
    });
    const matches = new Map((await this.repository.matchesForLines(tenantId, rows.map((r) => r.id))).map((m) => [m.lineId, m]));
    const needsSuggestion = rows.some((r) => r.status === 'unmatched' && r.direction === 'credit');
    const open = needsSuggestion ? [...(await this.loadOpenInvoices(tenantId)).values()] : [];
    return rows.map((row) => {
      const match = matches.get(row.id);
      const suggestion =
        row.status === 'unmatched' && row.direction === 'credit' ? suggestMatch(this.matchable(row), open) : null;
      return {
        id: row.id,
        bankAccountId: row.bankAccountId,
        bankTxnId: row.bankTxnId,
        bookingDate: row.bookingDate,
        valueDate: row.valueDate,
        amount: row.amount,
        direction: row.direction,
        currency: row.currency,
        reference: row.reference,
        counterparty: row.counterparty,
        status: row.status,
        suggestion: suggestion ? this.suggestionDto(suggestion) : null,
        match: match ? this.matchDto(match) : null,
      };
    });
  }

  // ------------------------------------------------------------------ confirm

  /**
   * Confirms the match of one credit line. Without `allocations` the current suggestion is confirmed;
   * with them the caller names the invoices (one payout to many invoices) and the bank fee.
   */
  async confirmMatch(tenantId: string, userId: string, lineId: string, dto: ConfirmStatementMatchDto): Promise<StatementMatchResponseDto> {
    const line = await this.repository.runInTransaction(tenantId, (m) => this.repository.findLineForUpdate(tenantId, lineId, m));
    if (!line) throw new NotFoundException('سطر صورتحساب بانکی یافت نشد.');
    if (line.status === 'matched') throw new ConflictException('این سطر قبلاً تطبیق و ثبت شده است.');
    if (line.direction !== 'credit') throw new BadRequestException('فقط واریزها به صورتحساب فروش تطبیق داده می‌شوند.');

    let plan: MatchPlan;
    if (dto.allocations) {
      plan = {
        rule: 'manual',
        auto: false,
        feeMinor: dto.fee === undefined ? 0n : minorOf(dto.fee, 'کارمزد'),
        allocations: dto.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: minorOf(a.amount, 'مبلغ تخصیص') })),
        explanation: 'Allocation chosen by the user.',
        note: dto.note,
      };
    } else {
      const open = await this.loadOpenInvoices(tenantId);
      const suggestion = suggestMatch(this.matchable(line), [...open.values()]);
      if (!suggestion) throw new BadRequestException('پیشنهادی برای این سطر وجود ندارد؛ تخصیص را دستی ارسال کنید.');
      plan = { ...this.planOf(suggestion), note: dto.note };
    }
    const lineMatch = await this.post(tenantId, userId, line, plan, false);
    return this.matchDto(lineMatch);
  }

  // ------------------------------------------------------------------ internals

  private planOf(s: MatchSuggestion): MatchPlan {
    return {
      rule: s.rule,
      auto: s.auto,
      feeMinor: s.feeMinor,
      allocations: s.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: a.amountMinor })),
      explanation: s.explanation,
    };
  }

  private matchable(row: StatementLineRow) {
    return { amountMinor: fromDb(row.amount), bookingDate: row.bookingDate, reference: row.reference };
  }

  /**
   * The one transaction of a confirmation: claim the line, lock the invoices, re-check what is still
   * open, post ONE voucher, store the match with its explanation. Any failure rolls all of it back.
   */
  private async post(
    tenantId: string,
    userId: string,
    line: StatementLineRow,
    plan: MatchPlan,
    auto: boolean,
  ): Promise<StatementMatchRow> {
    if (plan.allocations.length === 0) throw new BadRequestException('حداقل یک صورتحساب باید تخصیص داده شود.');
    const ids = plan.allocations.map((a) => a.invoiceId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('یک صورتحساب فقط یک بار می‌تواند در تخصیص بیاید.');
    if (plan.allocations.some((a) => a.amountMinor <= 0n)) throw new BadRequestException('مبلغ هر تخصیص باید بزرگ‌تر از صفر باشد.');
    if (plan.feeMinor < 0n) throw new BadRequestException('کارمزد نمی‌تواند منفی باشد.');
    const amount = fromDb(line.amount);
    const allocated = plan.allocations.reduce((s, a) => s + a.amountMinor, 0n);
    if (allocated !== amount + plan.feeMinor) {
      throw new BadRequestException(
        `مجموع تخصیص‌ها (${minorToDecimal(allocated)}) باید برابر مبلغ واریز (${minorToDecimal(amount)}) به‌علاوهٔ کارمزد (${minorToDecimal(plan.feeMinor)}) باشد.`,
      );
    }

    const facts = await this.loadInvoiceFacts(tenantId, ids);
    const account = (await this.banking.listAccounts(tenantId)).find((a) => a.id === line.bankAccountId);
    if (!account) throw new BadRequestException('حساب بانکی این سطر یافت نشد.');

    return this.repository.runInTransaction(tenantId, async (manager) => {
      await this.treasuryRepository.lockTargets(tenantId, ids, manager);
      if (!(await this.repository.markMatched(tenantId, line.id, manager))) {
        throw new ConflictException('این سطر قبلاً تطبیق و ثبت شده است.');
      }
      const open = await this.outstanding(tenantId, facts, manager);
      for (const a of plan.allocations) {
        const left = open.get(a.invoiceId) ?? 0n;
        if (a.amountMinor > left) {
          throw new BadRequestException(
            `مبلغ تخصیص به صورتحساب ${facts.get(a.invoiceId)?.number ?? a.invoiceId} (${minorToDecimal(a.amountMinor)}) از مانده باز آن (${minorToDecimal(left)}) بیشتر است.`,
          );
        }
      }

      // Roles only, no engine defaults: an unmapped role is a clear error, never a guessed account code.
      const receivable = await this.postingRules.mappedAccountForRole(tenantId, 'receivable', manager);
      if (!receivable) {
        throw new BadRequestException('نقش «حساب‌های دریافتنی» (receivable) در تنظیمات ثبت خودکار به حسابی نگاشت نشده است؛ ابتدا آن را نگاشت کنید.');
      }
      const fee = plan.feeMinor > 0n ? await this.postingRules.mappedAccountForRole(tenantId, 'bank_fee', manager) : null;
      if (plan.feeMinor > 0n && !fee) {
        throw new BadRequestException('نقش «کارمزد خدمات بانکی» (bank_fee) در تنظیمات ثبت خودکار به حسابی نگاشت نشده است؛ ابتدا آن را نگاشت کنید.');
      }

      const entry = await this.accounting.createJournalEntry(
        tenantId,
        {
          entryNumber: `BSM-${line.id}`,
          date: `${line.bookingDate}T00:00:00.000Z`,
          description: `تطبیق صورتحساب بانکی ${line.bankTxnId}`,
          lines: [
            { accountCode: account.ledgerAccountCode, debit: minorToDecimal(amount), credit: '0.00', description: `واریز ${line.bankTxnId}` },
            ...(plan.feeMinor > 0n
              ? [{ accountCode: fee as string, debit: minorToDecimal(plan.feeMinor), credit: '0.00', description: 'کارمزد بانکی' }]
              : []),
            ...plan.allocations.map((a) => {
              const inv = facts.get(a.invoiceId) as InvoiceFacts;
              return {
                accountCode: receivable,
                debit: '0.00',
                credit: minorToDecimal(a.amountMinor),
                description: `تسویه صورتحساب ${inv.number}`,
                ...(inv.partyCode ? { partyCode: inv.partyCode } : {}),
              };
            }),
          ],
        } as never,
        manager,
      );

      const allocations = plan.allocations.map((a) => ({
        invoiceId: a.invoiceId,
        invoiceNumber: facts.get(a.invoiceId)?.number ?? null,
        amount: minorToDecimal(a.amountMinor),
      }));
      const explanation = {
        rule: plan.rule,
        text: plan.explanation,
        bankTxnId: line.bankTxnId,
        reference: line.reference,
        amount: minorToDecimal(amount),
        fee: minorToDecimal(plan.feeMinor),
        allocations,
        ...(plan.note ? { note: plan.note } : {}),
      };
      const id = await this.repository.insertMatch(
        tenantId,
        {
          lineId: line.id,
          rule: plan.rule,
          auto,
          fee: minorToDecimal(plan.feeMinor),
          journalEntryId: entry.id,
          explanation,
          confirmedBy: userId,
          allocations,
        },
        manager,
      );
      return { id, lineId: line.id, rule: plan.rule, auto, fee: minorToDecimal(plan.feeMinor), journalEntryId: entry.id, explanation, confirmedBy: userId, allocations };
    });
  }

  /** Open amount per invoice: payable minus treasury allocations minus statement allocations. */
  private async outstanding(tenantId: string, facts: Map<string, InvoiceFacts>, manager: EntityManager): Promise<Map<string, bigint>> {
    const ids = [...facts.keys()];
    const [treasury, statement] = await Promise.all([
      this.treasuryRepository.allocatedByTarget(tenantId, ids, manager),
      this.repository.allocatedByInvoice(tenantId, ids, manager),
    ]);
    return new Map(
      ids.map((id) => [id, (facts.get(id) as InvoiceFacts).outstanding - fromDb(treasury.get(id) ?? '0') - fromDb(statement.get(id) ?? '0')]),
    );
  }

  /** Issued sales invoices named by the caller; `outstanding` here is the full payable (see `outstanding`). */
  private async loadInvoiceFacts(tenantId: string, ids: string[]): Promise<Map<string, InvoiceFacts>> {
    const out = new Map<string, InvoiceFacts>();
    for (const id of ids) {
      const inv = await this.invoicing.findOne(tenantId, id);
      if (inv.direction !== InvoiceDirection.SALE) throw new BadRequestException('واریز فقط به صورتحساب فروش تخصیص می‌یابد.');
      if (inv.status !== InvoiceStatus.ISSUED) {
        throw new BadRequestException(`صورتحساب ${inv.taxInvoiceNumber} صادر نشده یا قبلاً بسته/ابطال شده است.`);
      }
      out.set(id, this.factsOf(inv, minorOf(inv.finalPayable, 'مبلغ صورتحساب')));
    }
    return out;
  }

  private factsOf(
    inv: { id: string; taxInvoiceNumber: string; buyerInfo?: { partyCode?: string } | null; issuedAt?: Date | string | null; createdAt?: Date | string | null },
    payable: bigint,
  ): InvoiceFacts {
    const when = inv.issuedAt ?? inv.createdAt;
    const date = when ? new Date(when).toISOString().slice(0, 10) : null;
    return { id: inv.id, number: inv.taxInvoiceNumber, outstanding: payable, date, partyCode: inv.buyerInfo?.partyCode ?? null };
  }

  /** All issued sales invoices that still have an open amount, keyed by id. */
  private async loadOpenInvoices(tenantId: string): Promise<Map<string, InvoiceFacts>> {
    const all = new Map<string, InvoiceFacts>();
    for (let page = 1; page <= MAX_INVOICE_PAGES; page++) {
      const res = await this.invoicing.findAll(tenantId, {
        page,
        limit: INVOICE_PAGE_SIZE,
        status: InvoiceStatus.ISSUED,
        direction: InvoiceDirection.SALE,
      } as never);
      for (const inv of res.data) all.set(inv.id, this.factsOf(inv, minorOf(inv.finalPayable, 'مبلغ صورتحساب')));
      if (res.data.length < INVOICE_PAGE_SIZE) break;
    }
    const open = await this.repository.runInTransaction(tenantId, (m) => this.outstanding(tenantId, all, m));
    for (const [id, left] of open) {
      const facts = all.get(id) as InvoiceFacts;
      if (left > 0n) facts.outstanding = left;
      else all.delete(id);
    }
    return all;
  }

  private suggestionDto(s: MatchSuggestion): StatementSuggestionResponseDto {
    return {
      rule: s.rule,
      auto: s.auto,
      preselected: s.auto,
      fee: minorToDecimal(s.feeMinor),
      allocations: s.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoiceNumber, amount: minorToDecimal(a.amountMinor) })),
      explanation: s.explanation,
    };
  }

  private matchDto(m: StatementMatchRow): StatementMatchResponseDto {
    return {
      id: m.id,
      rule: m.rule,
      auto: m.auto,
      fee: m.fee,
      journalEntryId: m.journalEntryId,
      explanation: m.explanation,
      allocations: m.allocations,
    };
  }
}
