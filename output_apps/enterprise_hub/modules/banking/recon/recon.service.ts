import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { sniffFileKind } from '../../data_import/parsers/file-kind';
import { AccountingService } from '../../accounting/services/accounting.service';
import { minorToDecimal } from '../../accounting/money';
import { BankCode } from '../enums/banking.enum';
import { BankingService } from '../services/banking.service';
import {
  buildHistory,
  Category,
  CATEGORIES,
  classify,
  Classification,
  ClassifierContext,
  CONFIDENT,
  DEFAULT_CLASSIFIER_SETTINGS,
  PersonType,
  TenantRule,
} from './classify/classifier';
import { BankItem, BookItem, DEFAULT_MATCH_OPTIONS, matchStatement } from './matching/matcher';
import { evaluatePrerequisites, ImportedPeriod, KnownBankAccount, PrerequisiteResult } from './prerequisites';
import {
  parseStatement,
  readGrid,
  StatementParseError,
  validateColumnMap,
} from './parse/statement-parser';
import {
  applyAnswer,
  classificationQuestion,
  matchQuestion,
  Question,
} from './questions';
import {
  AnswerQuestionDtoShape,
  DraftView,
  ReviewView,
  SessionView,
} from './recon.types';
import {
  DraftRow,
  ItemRow,
  NewItem,
  ReconRepository,
  SessionRow,
  SettingsRow,
} from './recon.repository';
import {
  buildReconciliationStatement,
  ReconciliationStatement,
  reportToCsv,
  reportToHtml,
  reportToXlsx,
} from './report/reconciliation-report';
import { ledgerToMinor, MINOR_PER_RIAL, rialToMinor } from './rial';
import { ColumnMap, StatementRow } from './types';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const PG_UNIQUE_VIOLATION = '23505';

const isUnique = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === PG_UNIQUE_VIOLATION ||
    (error as { driverError?: { code?: string } }).driverError?.code === PG_UNIQUE_VIOLATION);

/** BigInt-safe JSON for snapshots. */
const jsonSafe = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v)));

const reviveBig = (value: unknown): unknown => {
  if (typeof value === 'string' && /^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  if (Array.isArray(value)) {
    return value.map(reviveBig);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveBig(v)]));
  }
  return value;
};

@Injectable()
export class ReconService {
  constructor(
    private readonly repo: ReconRepository,
    private readonly banking: BankingService,
    private readonly accounting: AccountingService,
  ) {}

  // ================================================================== settings

  async getSettings(tenantId: string) {
    return this.settingsView(await this.repo.getSettings(tenantId));
  }

  async updateSettings(
    tenantId: string,
    actor: string,
    dto: {
      feeMaxRial?: string;
      smsFeeMaxRial?: string;
      autoPostFees?: boolean;
      autoMatchMinConfidence?: number;
      dateWindowDays?: number;
      categoryAccounts?: Record<string, string>;
    },
  ) {
    const current = await this.repo.getSettings(tenantId);
    let accounts = current.category_accounts;
    if (dto.categoryAccounts) {
      const entries = Object.entries(dto.categoryAccounts);
      for (const [category, code] of entries) {
        if (!(CATEGORIES as readonly string[]).includes(category) || category === 'unknown') {
          throw new BadRequestException(`دسته نامعتبر: ${category}`);
        }
        if (typeof code !== 'string' || code.length > 32) {
          throw new BadRequestException('کد حساب نامعتبر است.');
        }
      }
      const known = await this.accounting.findExistingAccountCodes(
        tenantId,
        entries.map(([, code]) => code),
      );
      const missing = entries.filter(([, code]) => !known.includes(code));
      if (missing.length > 0) {
        throw new BadRequestException(`حساب دفتر کل یافت نشد: ${missing.map(([, c]) => c).join(', ')}`);
      }
      accounts = Object.fromEntries(entries);
    }
    const next: SettingsRow = {
      fee_max_rial: dto.feeMaxRial ?? current.fee_max_rial,
      sms_fee_max_rial: dto.smsFeeMaxRial ?? current.sms_fee_max_rial,
      auto_post_fees: dto.autoPostFees ?? current.auto_post_fees,
      auto_match_min_confidence:
        dto.autoMatchMinConfidence !== undefined
          ? dto.autoMatchMinConfidence.toFixed(3)
          : current.auto_match_min_confidence,
      date_window_days: dto.dateWindowDays ?? current.date_window_days,
      category_accounts: accounts,
    };
    if (next.auto_post_fees && !next.category_accounts.bank_fee) {
      throw new BadRequestException('برای ثبت خودکار کارمزد، حساب هزینه «bank_fee» را تعیین کنید.');
    }
    const saved = await this.repo.saveSettings(tenantId, actor, next);
    await this.repo.audit(tenantId, actor, 'settings.update', 'settings', null, {
      autoPostFees: saved.auto_post_fees,
      feeMaxRial: saved.fee_max_rial,
      smsFeeMaxRial: saved.sms_fee_max_rial,
      dateWindowDays: saved.date_window_days,
      autoMatchMinConfidence: saved.auto_match_min_confidence,
    });
    return this.settingsView(saved);
  }

  private settingsView(row: SettingsRow) {
    return {
      feeMaxRial: row.fee_max_rial,
      smsFeeMaxRial: row.sms_fee_max_rial,
      autoPostFees: row.auto_post_fees,
      autoMatchMinConfidence: Number(row.auto_match_min_confidence),
      dateWindowDays: row.date_window_days,
      categoryAccounts: row.category_accounts,
    };
  }

  // ================================================================== upload

  async uploadStatement(
    tenantId: string,
    actor: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    bankAccountId?: number,
  ): Promise<SessionView> {
    let grid;
    try {
      grid = readGrid(file.buffer, file.originalname, file.mimetype);
    } catch (error) {
      if (error instanceof StatementParseError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (bankAccountId) {
      const accounts = await this.banking.listAccounts(tenantId);
      if (!accounts.some((account) => account.id === bankAccountId)) {
        throw new BadRequestException('حساب بانکی انتخاب‌شده یافت نشد.');
      }
    }
    const session = await this.repo.createSession(tenantId, {
      fileName: file.originalname || 'statement',
      sha256: grid.sha256,
      kind: grid.kind,
      fileData: file.buffer,
      createdBy: actor,
      bankAccountId: bankAccountId ?? null,
    });
    await this.repo.audit(tenantId, actor, 'session.upload', 'session', session.id, {
      kind: grid.kind,
      sha256: grid.sha256,
      bytes: file.buffer.length,
    });
    return this.refresh(tenantId, session.id);
  }

  async submitMapping(tenantId: string, actor: string, sessionId: number, columnMap: Record<string, number>): Promise<SessionView> {
    const session = await this.requireOpenSession(tenantId, sessionId);
    const map = columnMap as ColumnMap;
    const grid = await this.gridOf(tenantId, session);
    const problem = validateColumnMap(map, Math.max(...grid.grid.map((row) => row.length), 0));
    if (problem) {
      throw new BadRequestException(problem);
    }
    await this.repo.updateSession(tenantId, sessionId, { column_map: map as Record<string, number> });
    await this.repo.audit(tenantId, actor, 'session.mapping', 'session', sessionId, { columnMap });
    return this.refresh(tenantId, sessionId);
  }

  async answerCheck(
    tenantId: string,
    actor: string,
    sessionId: number,
    code: string,
    choice: string,
  ): Promise<SessionView> {
    const session = await this.requireOpenSession(tenantId, sessionId);
    const check = (session.checks as Array<{ code: string; choices: Array<{ id: string }> }>).find(
      (c) => c.code === code,
    );
    if (!check || !check.choices.some((c) => c.id === choice)) {
      throw new BadRequestException('این پاسخ برای این پرسش مجاز نیست.');
    }
    let accountId: number | null | undefined;
    if (code === 'account_match' && choice.startsWith('account:')) {
      accountId = Number(choice.slice(8));
      const accounts = await this.banking.listAccounts(tenantId);
      if (!accounts.some((a) => a.id === accountId)) {
        throw new BadRequestException('حساب بانکی یافت نشد.');
      }
    }
    await this.repo.updateSession(tenantId, sessionId, {
      confirmations: { ...session.confirmations, [code]: choice },
      ...(accountId ? { bank_account_id: accountId } : {}),
    });
    await this.repo.audit(tenantId, actor, 'session.answer', 'session', sessionId, { code, choice });
    return this.refresh(tenantId, sessionId);
  }

  /** Guided create: a new bank account from the statement's own details, linked to a ledger account. */
  async createAccountFromSession(
    tenantId: string,
    actor: string,
    sessionId: number,
    dto: { name: string; ledgerAccountId: number },
  ): Promise<SessionView> {
    const session = await this.requireOpenSession(tenantId, sessionId);
    const header = session.header_info as { accountNumber?: string | null; iban?: string | null; bankCode?: string | null };
    const accountNumber = header.accountNumber ?? header.iban?.slice(-13) ?? null;
    if (!accountNumber) {
      throw new BadRequestException('در فایل شماره حساب یا شبا پیدا نشد؛ حساب را دستی تعریف کنید.');
    }
    const bankCode = (Object.values(BankCode) as string[]).includes(header.bankCode ?? '')
      ? (header.bankCode as BankCode)
      : BankCode.OTHER;
    const created = await this.banking.createAccount(tenantId, {
      name: dto.name,
      bankCode,
      accountNumber,
      iban: header.iban ?? undefined,
      ledgerAccountId: dto.ledgerAccountId,
      openingBalance:
        session.opening_balance !== null ? Number(session.opening_balance) : undefined,
    });
    await this.repo.updateSession(tenantId, sessionId, {
      bank_account_id: created.id,
      confirmations: { ...session.confirmations, account_match: `account:${created.id}` },
    });
    await this.repo.audit(tenantId, actor, 'account.create_from_statement', 'bank_account', created.id, {
      sessionId,
    });
    return this.refresh(tenantId, sessionId);
  }

  // ----------------------------------------------------------------- refresh

  private async gridOf(tenantId: string, session: SessionRow) {
    const data = await this.repo.getSessionFile(tenantId, session.id);
    if (!data) {
      throw new NotFoundException('فایل جلسه یافت نشد.');
    }
    return readGrid(data, session.file_name);
  }

  private knownAccounts(accounts: Awaited<ReturnType<BankingService['listAccounts']>>): KnownBankAccount[] {
    return accounts.map((account) => ({
      id: account.id,
      name: account.name,
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
      iban: account.iban,
      openingBalance: BigInt(Math.round(Number(account.openingBalance) || 0)),
    }));
  }

  /** Re-parses the stored file and re-runs the prerequisite checks; the single source of status. */
  async refresh(tenantId: string, sessionId: number): Promise<SessionView> {
    const session = await this.requireSession(tenantId, sessionId);
    if (session.status === 'committed' || session.status === 'closed') {
      return this.sessionView(session);
    }
    const file = await this.gridOf(tenantId, session);
    const outcome = parseStatement(file, session.column_map ?? undefined);
    if (outcome.status === 'needs_mapping') {
      await this.repo.updateSession(tenantId, sessionId, {
        status: 'needs_mapping',
        header_info: jsonSafe(outcome.header),
        checks: [],
      });
      return {
        ...this.sessionView({ ...session, status: 'needs_mapping', header_info: jsonSafe(outcome.header) as Record<string, unknown>, checks: [] }),
        mapping: {
          reason: outcome.reason,
          headers: outcome.headers,
          suggestedMap: outcome.suggestedMap,
          sampleRows: outcome.sampleRows.map((row) => row.map((cell) => cell.slice(0, 80))),
        },
      };
    }
    const accounts = this.knownAccounts(await this.banking.listAccounts(tenantId));
    const base = {
      header: outcome.header,
      rows: outcome.rows,
      fileSha256: file.sha256,
      accounts,
      chosenAccountId: session.bank_account_id,
      confirmations: session.confirmations,
    };
    let result = evaluatePrerequisites({ ...base, imported: [] });
    if (result.resolvedAccountId) {
      const imported = await this.repo.importedPeriods(tenantId, result.resolvedAccountId, sessionId);
      const periods: ImportedPeriod[] = imported.map((row) => ({
        sessionId: row.id,
        fileSha256: row.file_sha256.trim(),
        from: row.period_from,
        to: row.period_to,
        openingBalance: row.opening_balance === null ? null : BigInt(row.opening_balance),
        closingBalance: row.closing_balance === null ? null : BigInt(row.closing_balance),
      }));
      result = evaluatePrerequisites({ ...base, chosenAccountId: result.resolvedAccountId, imported: periods });
    }
    const status = result.canProceed ? 'ready' : 'needs_confirmation';
    const patch = {
      status,
      layout_id: outcome.layoutId,
      column_map: outcome.columnMap as Record<string, number>,
      header_info: jsonSafe(outcome.header),
      checks: result.checks,
      bank_account_id: result.resolvedAccountId,
      period_from: result.period?.from ?? null,
      period_to: result.period?.to ?? null,
      opening_balance: result.opening === null ? null : result.opening.toString(),
      closing_balance: result.closing === null ? null : result.closing.toString(),
    };
    await this.repo.updateSession(tenantId, sessionId, patch);
    return {
      ...this.sessionView({ ...session, ...patch } as SessionRow),
      rowCount: outcome.rows.length,
      skippedRows: outcome.issues,
      offerCreateAccount: result.offerCreateAccount,
    };
  }

  private sessionView(session: SessionRow): SessionView {
    return {
      id: session.id,
      status: session.status,
      fileName: session.file_name,
      bankAccountId: session.bank_account_id,
      period: session.period_from && session.period_to ? { from: session.period_from, to: session.period_to } : null,
      header: session.header_info,
      checks: session.checks as SessionView['checks'],
    };
  }

  // ================================================================== commit

  private async context(tenantId: string, bankAccountId: number): Promise<{ ctx: ClassifierContext; settings: SettingsRow; rules: TenantRule[] }> {
    const [settings, rules, history, accounts] = await Promise.all([
      this.repo.getSettings(tenantId),
      this.repo.listRules(tenantId),
      this.repo.confirmedHistory(tenantId),
      this.banking.listAccounts(tenantId),
    ]);
    const tenantRules: TenantRule[] = rules.map((rule) => ({
      id: rule.id,
      kind: rule.kind,
      pattern: rule.pattern,
      category: rule.category as Category,
      personType: (rule.person_type as PersonType | null) ?? null,
      counterAccountCode: rule.counter_account_code,
    }));
    return {
      settings,
      rules: tenantRules,
      ctx: {
        settings: {
          feeMaxRial: BigInt(settings.fee_max_rial),
          smsFeeMaxRial: BigInt(settings.sms_fee_max_rial),
        },
        rules: tenantRules,
        history: buildHistory(
          history.map((row) => ({ counterpartyKey: row.counterparty, category: row.category as Category })),
        ),
        ownAccounts: accounts
          .filter((account) => account.id !== bankAccountId)
          .map((account) => ({ accountNumber: account.accountNumber, iban: account.iban, names: [account.name] })),
      },
    };
  }

  private dedupeKeys(rows: StatementRow[]): string[] {
    const seen = new Map<string, number>();
    return rows.map((row) => {
      const base = [row.date, row.time ?? '', row.withdrawal, row.deposit, row.balance ?? '', row.reference ?? '', row.description].join('|');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return `r:${createHash('sha1').update(`${base}|${n}`).digest('hex')}`;
    });
  }

  async commit(tenantId: string, actor: string, sessionId: number): Promise<ReviewView> {
    const view = await this.refresh(tenantId, sessionId);
    const session = await this.requireSession(tenantId, sessionId);
    if (session.status === 'committed') {
      throw new ConflictException('این صورتحساب قبلاً ثبت شده است.');
    }
    if (view.status !== 'ready' || !session.bank_account_id) {
      throw new ConflictException('پیش‌نیازهای ورود صورتحساب هنوز کامل نیست.');
    }
    const file = await this.gridOf(tenantId, session);
    const outcome = parseStatement(file, session.column_map ?? undefined);
    if (outcome.status !== 'parsed') {
      throw new ConflictException('نگاشت ستون‌ها کامل نیست.');
    }
    const { ctx } = await this.context(tenantId, session.bank_account_id);
    const keys = this.dedupeKeys(outcome.rows);
    const usedRules = new Set<number>();
    const items: NewItem[] = outcome.rows.map((row, index) => {
      const result = classify(
        {
          id: index,
          direction: row.deposit > 0n ? 'in' : 'out',
          amountRial: row.deposit > 0n ? row.deposit : row.withdrawal,
          description: row.description,
        },
        ctx,
      );
      if (result.source === 'tenant_rule') {
        const hit = ctx.rules.find((rule) => result.evidence[0]?.includes(rule.pattern));
        if (hit) usedRules.add(hit.id);
      }
      const confident = result.confidence >= CONFIDENT && result.category !== 'unknown';
      return {
        sessionId,
        bankAccountId: session.bank_account_id as number,
        lineNo: row.rowNo,
        txnDate: row.date,
        txnTime: row.time,
        description: row.description,
        withdrawal: row.withdrawal,
        deposit: row.deposit,
        balance: row.balance,
        reference: row.reference,
        chequeNo: row.chequeNo,
        sayadId: row.sayadId,
        dedupeKey: keys[index],
        category: confident ? result.category : null,
        personType: result.personType,
        counterparty: result.counterparty,
        confidence: result.confidence,
        source: result.source,
        counterAccountCode: confident ? result.counterAccountCode : null,
      };
    });
    await this.repo.runInTransaction(async (manager) => {
      const inserted = await this.repo.insertItems(tenantId, items, manager);
      await this.repo.updateSession(
        tenantId,
        sessionId,
        { status: 'committed', committed_at: new Date() },
        manager,
      );
      await this.repo.audit(tenantId, actor, 'session.commit', 'session', sessionId, {
        rows: items.length,
        inserted: inserted.length,
        skippedExisting: items.length - inserted.length,
      }, manager);
    });
    await this.repo.bumpRuleHits(tenantId, [...usedRules]);
    return this.rerun(tenantId, actor, sessionId);
  }

  /**
   * Matching and drafting run after the rows are saved, so a failure there leaves a committed
   * session. Running this again finishes the job (also used after new vouchers are entered).
   */
  async rerun(tenantId: string, actor: string, sessionId: number): Promise<ReviewView> {
    await this.rematch(tenantId, actor, sessionId);
    await this.createDrafts(tenantId, actor, sessionId);
    return this.getReview(tenantId, sessionId);
  }

  // ================================================================== matching

  private bankItemOf(row: ItemRow): BankItem {
    const deposit = BigInt(row.deposit);
    return {
      id: row.id,
      date: row.txn_date,
      amount: rialToMinor(deposit > 0n ? deposit : BigInt(row.withdrawal)),
      direction: deposit > 0n ? 'in' : 'out',
      reference: row.reference,
      chequeNo: row.cheque_no,
      sayadId: row.sayad_id,
      description: row.description,
    };
  }

  private async bookItems(tenantId: string, ledgerAccountId: number, toDate: string, taken: Set<number>): Promise<{ items: BookItem[]; balance: bigint }> {
    const lines = await this.accounting.listLedgerLines(tenantId, ledgerAccountId, {
      toDate: new Date(`${toDate}T23:59:59.999Z`),
    });
    let balance = 0n;
    const items: BookItem[] = [];
    for (const line of lines) {
      const debit = ledgerToMinor(line.debit);
      const credit = ledgerToMinor(line.credit);
      balance += debit - credit;
      if (taken.has(line.id) || (debit === 0n && credit === 0n)) {
        continue;
      }
      items.push({
        id: line.id,
        date: new Date(line.date).toISOString().slice(0, 10),
        amount: debit > 0n ? debit : credit,
        direction: debit > 0n ? 'in' : 'out',
        entryNumber: line.entryNumber,
        text: `${line.description ?? ''} ${line.entryDescription ?? ''}`.trim(),
      });
    }
    return { items, balance };
  }

  /** Matches the session's open items to free ledger lines; safe to run again after new vouchers. */
  async rematch(tenantId: string, actor: string, sessionId: number): Promise<{ matched: number; suggested: number }> {
    const session = await this.requireSession(tenantId, sessionId);
    if (!session.bank_account_id || !session.period_to) {
      throw new ConflictException('جلسه هنوز کامل نیست.');
    }
    const account = (await this.banking.listAccounts(tenantId)).find((a) => a.id === session.bank_account_id);
    if (!account) {
      throw new NotFoundException('حساب بانکی یافت نشد.');
    }
    const settings = await this.repo.getSettings(tenantId);
    const items = (await this.repo.listItems(tenantId, sessionId)).filter((i) => i.status === 'open');
    const taken = await this.repo.takenJournalLineIds(tenantId);
    // Book side runs a window beyond the statement end: a voucher dated a day later can still match.
    const horizon = new Date(`${session.period_to}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + settings.date_window_days);
    const { items: book } = await this.bookItems(tenantId, account.ledgerAccountId, horizon.toISOString().slice(0, 10), taken);
    await this.repo.clearSuggested(tenantId, sessionId);
    const result = matchStatement(items.map((i) => this.bankItemOf(i)), book, {
      ...DEFAULT_MATCH_OPTIONS,
      windowDays: settings.date_window_days,
      autoMinConfidence: Number(settings.auto_match_min_confidence),
    });
    await this.repo.runInTransaction(async (manager) => {
      for (const [groups, status] of [[result.matched, 'confirmed'], [result.suggested, 'suggested']] as const) {
        for (const group of groups) {
          for (const itemId of group.bankIds) {
            for (const journalLineId of group.bookIds) {
              await this.repo.insertMatch(tenantId, {
                sessionId,
                groupId: `${sessionId}-${group.id}-${status}`,
                itemId,
                journalLineId,
                stage: group.stage,
                confidence: group.confidence,
                status,
                method: 'auto',
                decidedBy: status === 'confirmed' ? 'system' : null,
              }, manager);
            }
            if (status === 'confirmed') {
              await this.repo.updateItem(tenantId, itemId, { status: 'matched' }, manager);
            }
          }
        }
      }
      await this.repo.audit(tenantId, actor, 'session.match', 'session', sessionId, {
        matched: result.matched.length,
        suggested: result.suggested.length,
        unmatched: result.unmatchedBank.length,
      }, manager);
    });
    return { matched: result.matched.length, suggested: result.suggested.length };
  }

  async decideMatch(tenantId: string, actor: string, sessionId: number, groupId: string, accept: boolean) {
    await this.requireSession(tenantId, sessionId);
    const matches = (await this.repo.listMatches(tenantId, sessionId)).filter(
      (m) => m.group_id === groupId && m.status === 'suggested',
    );
    if (matches.length === 0) {
      throw new NotFoundException('پیشنهاد تطبیق یافت نشد.');
    }
    try {
      await this.repo.runInTransaction(async (manager) => {
        await this.repo.setGroupStatus(tenantId, sessionId, groupId, accept ? 'confirmed' : 'rejected', actor, manager);
        if (accept) {
          for (const itemId of new Set(matches.map((m) => m.item_id))) {
            await this.repo.updateItem(tenantId, itemId, { status: 'matched' }, manager);
          }
        }
        await this.repo.audit(tenantId, actor, accept ? 'match.accept' : 'match.reject', 'match_group', groupId, { sessionId }, manager);
      });
    } catch (error) {
      if (isUnique(error)) {
        throw new ConflictException('یکی از سندهای این تطبیق همین حالا با ردیف دیگری تطبیق خورد.');
      }
      throw error;
    }
    return this.getReview(tenantId, sessionId);
  }

  // ================================================================ questions

  private questionItem(row: ItemRow) {
    const deposit = BigInt(row.deposit);
    return {
      id: row.id,
      direction: (deposit > 0n ? 'in' : 'out') as 'in' | 'out',
      amountRial: deposit > 0n ? deposit : BigInt(row.withdrawal),
      date: row.txn_date,
      description: row.description,
    };
  }

  private async classificationOf(tenantId: string, row: ItemRow): Promise<{ q: ReturnType<ReconService['questionItem']>; c: Classification }> {
    const { ctx } = await this.context(tenantId, row.bank_account_id);
    const q = this.questionItem(row);
    return { q, c: classify({ id: q.id, direction: q.direction, amountRial: q.amountRial, description: q.description }, ctx) };
  }

  async answerQuestion(tenantId: string, actor: string, itemId: number, dto: AnswerQuestionDtoShape): Promise<{ item: unknown; draft: DraftView | null }> {
    const row = await this.repo.getItem(tenantId, itemId);
    if (!row) {
      throw new NotFoundException('ردیف صورتحساب یافت نشد.');
    }
    if (row.status === 'matched') {
      throw new ConflictException('این ردیف قبلاً با یک سند تطبیق خورده است.');
    }
    const live = (await this.repo.listDrafts(tenantId, row.session_id)).find(
      (d) => d.item_id === itemId && ['approved', 'posted'].includes(d.status),
    );
    if (live) {
      throw new ConflictException('برای این ردیف سند ثبت شده؛ ابتدا سند را با برگشت اصلاح کنید.');
    }
    if (dto.counterAccountCode) {
      const known = await this.accounting.findExistingAccountCodes(tenantId, [dto.counterAccountCode]);
      if (!known.includes(dto.counterAccountCode)) {
        throw new BadRequestException('کد حساب مقابل در دفتر کل یافت نشد.');
      }
    }
    const { q, c } = await this.classificationOf(tenantId, row);
    const question = classificationQuestion(q, c, { force: true }) as Question;
    const outcome = applyAnswer(question, dto.choiceId, c, {
      personType: dto.personType,
      counterAccountCode: dto.counterAccountCode,
      keyword: dto.keyword,
      remember: dto.remember,
    });
    if (!outcome) {
      throw new BadRequestException('پاسخ نامعتبر است.');
    }
    let draft: DraftRow | null = null;
    await this.repo.runInTransaction(async (manager) => {
      if (outcome.rule) {
        await this.repo.upsertRule(tenantId, actor, { ...outcome.rule, sourceItemId: itemId }, manager);
      }
      await this.repo.updateItem(tenantId, itemId, {
        category: outcome.category,
        person_type: outcome.personType,
        classification_confidence: '1.000',
        classification_source: 'tenant_rule',
        counter_account_code: dto.counterAccountCode ?? row.counter_account_code,
        status: 'resolved',
      }, manager);
      await this.repo.audit(tenantId, actor, 'question.answer', 'item', itemId, {
        category: outcome.category,
        personType: outcome.personType,
        ruleCreated: Boolean(outcome.rule),
      }, manager);
    });
    draft = await this.draftFor(tenantId, actor, (await this.repo.getItem(tenantId, itemId)) as ItemRow, false);
    return { item: await this.itemView(tenantId, itemId), draft: draft ? this.draftView(draft) : null };
  }

  async attachDocument(tenantId: string, actor: string, itemId: number, file: { buffer: Buffer; originalname: string }) {
    const row = await this.repo.getItem(tenantId, itemId);
    if (!row) {
      throw new NotFoundException('ردیف صورتحساب یافت نشد.');
    }
    if (file.buffer.length === 0) {
      throw new BadRequestException('فایل خالی است.');
    }
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException('حجم پیوست بیش از ۵ مگابایت است.');
    }
    const kind = sniffFileKind(file.buffer, file.originalname);
    const mimes: Record<string, string> = { pdf: 'application/pdf', image: 'image/*', xlsx: 'application/vnd.ms-excel', csv: 'text/csv' };
    if (kind === 'unknown') {
      throw new BadRequestException('نوع پیوست پشتیبانی نمی‌شود (PDF، تصویر، Excel یا CSV).');
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const id = await this.repo.insertAttachment(tenantId, {
      itemId,
      fileName: file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_'),
      mime: mimes[kind],
      size: file.buffer.length,
      sha256,
      data: file.buffer,
      uploadedBy: actor,
    });
    await this.repo.audit(tenantId, actor, 'attachment.add', 'item', itemId, { attachmentId: id, sha256 });
    return { id, sha256, size: file.buffer.length };
  }

  // =================================================================== drafts

  /** Draft voucher for a classified, unmatched item. Null when the counter account is unknown. */
  private async draftFor(tenantId: string, actor: string, row: ItemRow, auto: boolean): Promise<DraftRow | null> {
    if (!row.category || row.category === 'unknown' || row.status === 'matched') {
      return null;
    }
    const settings = await this.repo.getSettings(tenantId);
    const code = row.counter_account_code ?? settings.category_accounts[row.category] ?? null;
    if (!code) {
      return null;
    }
    const deposit = BigInt(row.deposit);
    return this.repo.insertDraft(tenantId, {
      sessionId: row.session_id,
      itemId: row.id,
      bankAccountId: row.bank_account_id,
      entryDate: row.txn_date,
      description: row.description || 'سطر صورتحساب بانک',
      amount: deposit > 0n ? deposit : BigInt(row.withdrawal),
      direction: deposit > 0n ? 'in' : 'out',
      counterAccountCode: code,
      category: row.category,
      auto,
      createdBy: actor,
    });
  }

  private async createDrafts(tenantId: string, actor: string, sessionId: number): Promise<void> {
    const settings = await this.repo.getSettings(tenantId);
    // An item that already had a draft keeps its history: a rejected fee is never drafted or posted again here.
    const drafted = new Set((await this.repo.listDrafts(tenantId, sessionId)).map((d) => d.item_id));
    const items = (await this.repo.listItems(tenantId, sessionId)).filter(
      (i) => i.status === 'open' && i.category && !drafted.has(i.id),
    );
    const limits = {
      bank_fee: BigInt(settings.fee_max_rial),
      sms_fee: BigInt(settings.sms_fee_max_rial),
    };
    for (const item of items) {
      const amount = BigInt(item.deposit) > 0n ? BigInt(item.deposit) : BigInt(item.withdrawal);
      const isFee = (item.category === 'bank_fee' || item.category === 'sms_fee') && item.classification_source === 'fee_rule';
      const eligible = isFee && BigInt(item.withdrawal) > 0n && amount <= limits[item.category as 'bank_fee' | 'sms_fee'];
      const draft = await this.draftFor(tenantId, actor, item, settings.auto_post_fees && eligible);
      if (draft?.auto) {
        // Rule-based auto-post: only fees, only when a tenant admin switched it on in settings.
        await this.approveDrafts(tenantId, `auto:${actor}`, [draft.id], true);
      }
    }
  }

  async approveDrafts(
    tenantId: string,
    actor: string,
    draftIds: number[],
    autoPost = false,
  ): Promise<Array<{ id: number; status: string; reason?: string; journalEntryId?: number }>> {
    const results: Array<{ id: number; status: string; reason?: string; journalEntryId?: number }> = [];
    for (const id of [...new Set(draftIds)]) {
      const draft = await this.repo.getDraft(tenantId, id);
      if (!draft || draft.status !== 'draft') {
        results.push({ id, status: 'skipped', reason: 'پیش‌نویس یافت نشد یا قبلاً بررسی شده است.' });
        continue;
      }
      if (autoPost && !draft.auto) {
        results.push({ id, status: 'skipped', reason: 'ثبت خودکار فقط برای کارمزد مجاز است.' });
        continue;
      }
      if (!(await this.repo.claimDraft(tenantId, id, actor))) {
        results.push({ id, status: 'skipped', reason: 'همزمان توسط کاربر دیگری بررسی شد.' });
        continue;
      }
      try {
        const entryId = await this.post(tenantId, actor, draft);
        results.push({ id, status: 'posted', journalEntryId: entryId });
      } catch (error) {
        const reason = this.failureReason(error);
        await this.repo.updateDraft(tenantId, id, { status: 'failed', failure_reason: reason });
        await this.repo.audit(tenantId, actor, 'draft.fail', 'draft', id, { reason });
        results.push({ id, status: 'failed', reason });
      }
    }
    await this.repo.audit(tenantId, actor, autoPost ? 'draft.autopost' : 'draft.batch_approve', 'draft', null, {
      ids: draftIds,
      posted: results.filter((r) => r.status === 'posted').length,
      failed: results.filter((r) => r.status === 'failed').length,
    });
    return results;
  }

  private failureReason(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message = typeof response === 'string' ? response : (response as { message?: string | string[] }).message;
      const text = Array.isArray(message) ? message.join('، ') : message;
      return error.getStatus() === 423 ? `دوره قفل است: ${text ?? ''}`.trim() : (text ?? 'خطا در ثبت سند');
    }
    return 'خطا در ثبت سند';
  }

  private async post(tenantId: string, actor: string, draft: DraftRow): Promise<number> {
    const accounts = await this.banking.listAccounts(tenantId);
    const account = accounts.find((a) => a.id === draft.bank_account_id);
    if (!account) {
      throw new BadRequestException('حساب بانکی یافت نشد.');
    }
    if (account.ledgerAccountCode === draft.counter_account_code) {
      throw new BadRequestException('حساب مقابل نمی‌تواند همان حساب بانک باشد.');
    }
    const isIn = draft.direction === 'in';
    return this.repo.runInTransaction(async (manager) => {
      const entry = await this.accounting.createJournalEntry(
        tenantId,
        {
          entryNumber: `RCN-${draft.id}`,
          date: draft.entry_date,
          description: draft.description,
          lines: [
            { accountCode: account.ledgerAccountCode, debit: isIn ? draft.amount : '0', credit: isIn ? '0' : draft.amount, description: draft.description },
            { accountCode: draft.counter_account_code, debit: isIn ? '0' : draft.amount, credit: isIn ? draft.amount : '0', description: draft.description },
          ],
        },
        manager,
      );
      const bankLine = entry.lines.find((line) => line.accountId === account.ledgerAccountId);
      if (!bankLine) {
        throw new BadRequestException('سطر بانک در سند ساخته‌شده یافت نشد.');
      }
      await this.repo.insertMatch(tenantId, {
        sessionId: draft.session_id,
        groupId: `${draft.session_id}-draft-${draft.id}`,
        itemId: draft.item_id,
        journalLineId: bankLine.id,
        stage: 'created',
        confidence: 1,
        status: 'confirmed',
        method: draft.auto ? 'auto' : 'user',
        decidedBy: actor,
      }, manager);
      await this.repo.updateItem(tenantId, draft.item_id, { status: 'matched' }, manager);
      await this.repo.updateDraft(tenantId, draft.id, { status: 'posted', journal_entry_id: entry.id }, manager);
      await this.repo.audit(tenantId, actor, 'draft.post', 'draft', draft.id, { journalEntryId: entry.id, auto: draft.auto }, manager);
      return entry.id;
    });
  }

  async rejectDraft(tenantId: string, actor: string, draftId: number): Promise<DraftView> {
    const draft = await this.repo.getDraft(tenantId, draftId);
    if (!draft || draft.status !== 'draft') {
      throw new NotFoundException('پیش‌نویس قابل رد یافت نشد.');
    }
    await this.repo.updateDraft(tenantId, draftId, { status: 'rejected', decided_by: actor });
    await this.repo.audit(tenantId, actor, 'draft.reject', 'draft', draftId);
    return this.draftView({ ...draft, status: 'rejected' });
  }

  /** Correction is reversal-only: a reversing voucher is posted, the original stays in the ledger. */
  async reverseDraft(tenantId: string, actor: string, draftId: number, reason: string): Promise<DraftView> {
    const draft = await this.repo.getDraft(tenantId, draftId);
    if (!draft || draft.status !== 'posted' || !draft.journal_entry_id) {
      throw new NotFoundException('سند ثبت‌شده‌ای برای برگشت یافت نشد.');
    }
    let reversalId: number | null = null;
    try {
      const reversal = await this.accounting.reverseJournalEntry(tenantId, draft.journal_entry_id, { reason });
      reversalId = reversal.id;
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error; // 423 locked period etc. surface unchanged
      }
    }
    await this.repo.runInTransaction(async (manager) => {
      await this.repo.releaseMatchesOfItem(tenantId, draft.item_id, manager);
      await this.repo.updateItem(tenantId, draft.item_id, { status: 'open' }, manager);
      await this.repo.updateDraft(tenantId, draftId, { status: 'reversed', reversal_entry_id: reversalId, decided_by: actor }, manager);
      await this.repo.audit(tenantId, actor, 'draft.reverse', 'draft', draftId, { reason, reversalEntryId: reversalId }, manager);
    });
    return this.draftView({ ...draft, status: 'reversed', reversal_entry_id: reversalId });
  }

  private draftView(draft: DraftRow): DraftView {
    return {
      id: draft.id,
      itemId: draft.item_id,
      date: draft.entry_date,
      description: draft.description,
      amountRial: draft.amount,
      direction: draft.direction,
      counterAccountCode: draft.counter_account_code,
      category: draft.category,
      status: draft.status,
      auto: draft.auto,
      journalEntryId: draft.journal_entry_id,
      reversalEntryId: draft.reversal_entry_id,
      failureReason: draft.failure_reason,
    };
  }

  // ================================================================== review

  private async itemView(tenantId: string, itemId: number) {
    const row = await this.repo.getItem(tenantId, itemId);
    return row ? this.itemRow(row) : null;
  }

  private itemRow(row: ItemRow) {
    return {
      id: row.id,
      lineNo: row.line_no,
      date: row.txn_date,
      time: row.txn_time,
      description: row.description,
      withdrawalRial: row.withdrawal,
      depositRial: row.deposit,
      balanceRial: row.balance,
      reference: row.reference,
      chequeNo: row.cheque_no,
      sayadId: row.sayad_id,
      category: row.category,
      personType: row.person_type,
      counterparty: row.counterparty,
      confidence: Number(row.classification_confidence),
      source: row.classification_source,
      status: row.status,
    };
  }

  async getReview(tenantId: string, sessionId: number): Promise<ReviewView> {
    const session = await this.requireSession(tenantId, sessionId);
    const [items, matches, drafts] = await Promise.all([
      this.repo.listItems(tenantId, sessionId),
      this.repo.listMatches(tenantId, sessionId),
      this.repo.listDrafts(tenantId, sessionId),
    ]);
    const account = session.bank_account_id
      ? (await this.banking.listAccounts(tenantId)).find((a) => a.id === session.bank_account_id)
      : undefined;
    const lineIds = [...new Set(matches.map((m) => m.journal_line_id))];
    const lines = account && lineIds.length
      ? await this.accounting.listLedgerLines(tenantId, account.ledgerAccountId, { lineIds })
      : [];
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const groups = new Map<string, { status: string; stage: string; confidence: number; itemIds: Set<number>; lineIds: Set<number> }>();
    for (const m of matches) {
      const g = groups.get(m.group_id) ?? { status: m.status, stage: m.stage, confidence: Number(m.confidence), itemIds: new Set(), lineIds: new Set() };
      g.itemIds.add(m.item_id);
      g.lineIds.add(m.journal_line_id);
      groups.set(m.group_id, g);
    }
    const groupView = (id: string, g: NonNullable<ReturnType<typeof groups.get>>) => ({
      groupId: id,
      stage: g.stage,
      confidence: g.confidence,
      items: [...g.itemIds].map((i) => itemById.get(i)).filter(Boolean).map((i) => this.itemRow(i as ItemRow)),
      bookLines: [...g.lineIds].map((l) => lineById.get(l)).filter(Boolean).map((l) => ({
        id: l!.id,
        entryNumber: l!.entryNumber,
        date: l!.date,
        description: l!.description ?? l!.entryDescription,
        debit: l!.debit,
        credit: l!.credit,
      })),
    });
    const matched = [...groups].filter(([, g]) => g.status === 'confirmed').map(([id, g]) => groupView(id, g));
    const suggested = [...groups].filter(([, g]) => g.status === 'suggested').map(([id, g]) => groupView(id, g));
    const questions: Array<Question & { groupId?: string }> = [];
    const unmatched = items.filter((i) => i.status === 'open' || i.status === 'resolved');
    const context = account ? (await this.context(tenantId, session.bank_account_id ?? 0)).ctx : null;
    for (const row of unmatched) {
      if (!context) break;
      const q = this.questionItem(row);
      const c = classify({ id: q.id, direction: q.direction, amountRial: q.amountRial, description: q.description }, context);
      const live = drafts.some((d) => d.item_id === row.id && ['draft', 'approved', 'posted'].includes(d.status));
      if (row.status === 'open' && !live) {
        const question = classificationQuestion(q, c);
        if (question) questions.push(question);
      }
    }
    for (const [id, g] of groups) {
      if (g.status === 'suggested') {
        const first = [...g.itemIds][0];
        const row = itemById.get(first);
        if (row) {
          questions.push({
            ...matchQuestion(
              { id, stage: g.stage as never, bankIds: [...g.itemIds], bookIds: [...g.lineIds], confidence: g.confidence, reasons: [] },
              this.questionItem(row),
            ),
            groupId: id,
          });
        }
      }
    }
    return {
      session: this.sessionView(session),
      matched,
      suggested,
      unmatched: unmatched.map((row) => {
        const draft = drafts.filter((d) => d.item_id === row.id).map((d) => this.draftView(d)).pop() ?? null;
        return {
          ...this.itemRow(row),
          draft,
          // Classified but no counter account known yet: the person must pick one.
          needsAccount: Boolean(row.category) && row.status === 'open' && !draft,
        };
      }),
      drafts: drafts.map((d) => this.draftView(d)),
      questions,
      counts: { matched: matched.length, suggested: suggested.length, unmatched: unmatched.length, drafts: drafts.length },
    };
  }

  // ================================================================== report

  async buildReport(tenantId: string, actor: string, sessionId: number): Promise<{ id: number; report: unknown; statement: ReconciliationStatement }> {
    const session = await this.requireSession(tenantId, sessionId);
    if (session.status !== 'committed' || !session.bank_account_id || !session.period_from || !session.period_to) {
      throw new ConflictException('ابتدا صورتحساب را ثبت کنید.');
    }
    if (session.closing_balance === null) {
      throw new ConflictException('مانده پایان صورتحساب مشخص نیست.');
    }
    const account = (await this.banking.listAccounts(tenantId)).find((a) => a.id === session.bank_account_id);
    if (!account) {
      throw new NotFoundException('حساب بانکی یافت نشد.');
    }
    const bankItems = await this.repo.listItemsForAccount(tenantId, account.id, session.period_to);
    const cleared = new Set((await this.repo.listMatchesForItems(tenantId, bankItems.map((i) => i.id))).map((m) => m.item_id));
    const taken = await this.repo.takenJournalLineIds(tenantId);
    const { items: book, balance } = await this.bookItems(tenantId, account.ledgerAccountId, session.period_to, taken);
    const statement = buildReconciliationStatement({
      bankAccountName: account.name,
      periodFrom: session.period_from,
      periodTo: session.period_to,
      bankBalance: BigInt(session.closing_balance) * MINOR_PER_RIAL,
      ledgerBalance: balance,
      unmatchedBank: bankItems.filter((i) => !cleared.has(i.id)).map((i) => this.bankItemOf(i)),
      unmatchedBook: book,
    });
    const id = await this.repo.insertReport(tenantId, {
      bankAccountId: account.id,
      sessionId,
      periodFrom: session.period_from,
      periodTo: session.period_to,
      differenceMinor: statement.difference,
      snapshot: jsonSafe(statement),
      createdBy: actor,
    });
    await this.repo.audit(tenantId, actor, 'report.create', 'report', id, { difference: minorToDecimal(statement.difference) });
    return { id, report: this.statementView(statement), statement };
  }

  private statementView(statement: ReconciliationStatement) {
    return JSON.parse(JSON.stringify(statement, (_k, v) => (typeof v === 'bigint' ? minorToDecimal(v) : v)));
  }

  async listReports(tenantId: string, bankAccountId?: number) {
    return (await this.repo.listReports(tenantId, bankAccountId)).map((row) => ({
      id: row.id,
      bankAccountId: row.bank_account_id,
      sessionId: row.session_id,
      periodFrom: row.period_from,
      periodTo: row.period_to,
      difference: minorToDecimal(BigInt(row.difference_minor)),
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }

  async exportReport(tenantId: string, reportId: number, format: 'json' | 'xlsx' | 'csv' | 'html') {
    const row = await this.repo.getReport(tenantId, reportId);
    if (!row) {
      throw new NotFoundException('گزارش یافت نشد.');
    }
    const statement = reviveBig(row.snapshot) as ReconciliationStatement;
    if (format === 'xlsx') {
      return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: reportToXlsx(statement), filename: `reconciliation-${reportId}.xlsx` };
    }
    if (format === 'csv') {
      return { contentType: 'text/csv; charset=utf-8', body: Buffer.from(reportToCsv(statement), 'utf8'), filename: `reconciliation-${reportId}.csv` };
    }
    if (format === 'html') {
      return { contentType: 'text/html; charset=utf-8', body: Buffer.from(reportToHtml(statement), 'utf8'), filename: `reconciliation-${reportId}.html` };
    }
    return { contentType: 'application/json', body: Buffer.from(JSON.stringify(this.statementView(statement))), filename: `reconciliation-${reportId}.json` };
  }

  // ===================================================================== misc

  async listSessions(tenantId: string, bankAccountId?: number) {
    return (await this.repo.listSessions(tenantId, bankAccountId)).map((s) => this.sessionView(s));
  }

  /** Open sessions re-evaluate, so a reopened page gets the same guidance as the upload response. */
  getSession(tenantId: string, sessionId: number): Promise<SessionView> {
    return this.refresh(tenantId, sessionId);
  }

  listRules(tenantId: string) {
    return this.repo.listRules(tenantId);
  }

  async deleteRule(tenantId: string, actor: string, id: number) {
    if (!(await this.repo.deactivateRule(tenantId, id))) {
      throw new NotFoundException('قانون یافت نشد.');
    }
    await this.repo.audit(tenantId, actor, 'rule.deactivate', 'rule', id);
  }

  listAudit(tenantId: string, subjectType?: string, subjectId?: string) {
    return this.repo.listAudit(tenantId, subjectType, subjectId);
  }

  private async requireSession(tenantId: string, id: number): Promise<SessionRow> {
    const session = await this.repo.getSession(tenantId, id);
    if (!session) {
      throw new NotFoundException('جلسه ورود صورتحساب یافت نشد.');
    }
    return session;
  }

  private async requireOpenSession(tenantId: string, id: number): Promise<SessionRow> {
    const session = await this.requireSession(tenantId, id);
    if (session.status === 'committed' || session.status === 'closed') {
      throw new ConflictException('این صورتحساب قبلاً ثبت شده و قابل تغییر نیست.');
    }
    return session;
  }
}

export { DEFAULT_CLASSIFIER_SETTINGS };
