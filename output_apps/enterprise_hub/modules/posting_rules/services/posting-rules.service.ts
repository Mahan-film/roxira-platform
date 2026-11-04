import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccountLevel } from '../../accounting/enums/accounting.enum';
import { AccountingService } from '../../accounting/services/accounting.service';
import { ALL_DOC_TYPES, DEFAULT_ROLE_ACCOUNTS, isPostingRole, POSTING_ROLES, PostingRole } from '../constants/posting-roles';
import { Amounts, buildProposal, requireTemplate, resolveRole, RoleAccounts, toJournalLines, VoucherProposal } from '../domain/posting-engine';
import { PostingRuleError } from '../domain/posting-error';
import { POSTING_TEMPLATES } from '../domain/posting-templates';
import { PostingRulesRepository } from '../repositories/posting-rules.repository';

export interface PostingRequest {
  docType: string;
  /** The document that causes the voucher, e.g. "payroll_run" / "42". One voucher per source. */
  sourceType: string;
  sourceId: string;
  /** ISO 8601 date of the document (never the clock). */
  date: string;
  amounts: Amounts;
  description: string;
  partyCode?: string;
  /** Voucher number; defaults to `<sourceType>-<sourceId>`. */
  entryNumber?: string;
  overrides?: RoleAccounts;
}

export interface PostingResult {
  entryId: number;
  entryNumber: string;
  /** True when the source document was already posted and nothing new was written. */
  replayed: boolean;
}

/**
 * The single place that turns a business document into a voucher: template + the tenant's role
 * mapping + amounts -> balanced proposal -> `createJournalEntry`. Idempotent per source document.
 */
@Injectable()
export class PostingRulesService {
  constructor(
    private readonly repository: PostingRulesRepository,
    private readonly accounting: AccountingService,
  ) {}

  /** Tenant mapping for a doc type: its own rows win over the tenant-wide "*" rows. */
  private async mappingFor(tenantId: string, docType: string, manager?: EntityManager): Promise<RoleAccounts> {
    const rows = await this.repository.listMappings(tenantId, [ALL_DOC_TYPES, docType], manager);
    const mapping: Partial<Record<PostingRole, string>> = {};
    for (const row of rows.filter((r) => r.docType === ALL_DOC_TYPES)) if (isPostingRole(row.role)) mapping[row.role] = row.accountCode;
    for (const row of rows.filter((r) => r.docType === docType)) if (isPostingRole(row.role)) mapping[row.role] = row.accountCode;
    return mapping;
  }

  /** Refuses codes that are not in the tenant's chart or are header (group / kol) accounts. */
  private async assertPostable(tenantId: string, proposal: VoucherProposal): Promise<void> {
    const accounts = new Map((await this.accounting.listAccounts(tenantId)).map((a) => [a.code, a]));
    for (const line of proposal.lines) {
      const account = accounts.get(line.accountCode);
      if (!account) {
        throw new PostingRuleError('UNKNOWN_ACCOUNT', `حساب ${line.accountCode} برای نقش «${POSTING_ROLES[line.role].label}» در دفتر کل سازمان وجود ندارد؛ نگاشت را در تنظیمات ثبت خودکار اصلاح کنید.`);
      }
      if (account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL) {
        throw new PostingRuleError('HEADER_ACCOUNT', `حساب ${line.accountCode} گروه یا کل است و سند روی آن ثبت نمی‌شود؛ حساب معین یا تفصیلی را برای نقش «${POSTING_ROLES[line.role].label}» انتخاب کنید.`);
      }
    }
  }

  /** The balanced voucher a document would post, checked against the tenant's chart. No write. */
  async propose(tenantId: string, request: PostingRequest, manager?: EntityManager): Promise<VoucherProposal> {
    const mapping = await this.mappingFor(tenantId, request.docType, manager);
    const proposal = buildProposal({
      docType: request.docType,
      amounts: request.amounts,
      mapping,
      overrides: request.overrides,
      partyCode: request.partyCode,
    });
    await this.assertPostable(tenantId, proposal);
    return proposal;
  }

  /**
   * Posts the voucher of a source document once. A second call for the same source returns the
   * first voucher (`replayed: true`) and writes nothing. Runs in the caller's transaction when
   * a `manager` is given, so the source row and the voucher commit or roll back together.
   */
  async post(tenantId: string, request: PostingRequest, manager?: EntityManager): Promise<PostingResult> {
    const run = async (m: EntityManager): Promise<PostingResult> => {
      const existing = await this.repository.findSource(tenantId, request.sourceType, request.sourceId, request.docType, m);
      if (existing?.entryId) return { entryId: existing.entryId, entryNumber: existing.entryNumber ?? '', replayed: true };

      const proposal = await this.propose(tenantId, request, m);
      if (!(await this.repository.claimSource(tenantId, request.sourceType, request.sourceId, request.docType, m))) {
        const raced = await this.repository.findSource(tenantId, request.sourceType, request.sourceId, request.docType, m);
        if (raced?.entryId) return { entryId: raced.entryId, entryNumber: raced.entryNumber ?? '', replayed: true };
        // claimed by a transaction that has not finished: never post a second voucher
        throw new ConflictException('ثبت سند این سند منبع در حال انجام است؛ دوباره تلاش کنید.');
      }
      const entry = await this.accounting.createJournalEntry(
        tenantId,
        {
          entryNumber: this.entryNumberOf(request),
          date: request.date,
          description: request.description,
          lines: toJournalLines(proposal),
        },
        m,
      );
      await this.repository.attachEntry(tenantId, request.sourceType, request.sourceId, request.docType, entry.id, entry.entryNumber, m);
      return { entryId: entry.id, entryNumber: entry.entryNumber, replayed: false };
    };
    return manager ? run(manager) : this.repository.runInTransaction(tenantId, run);
  }

  /** `<sourceType>-<sourceId>` unless given; either way it must fit the 64-char column. */
  private entryNumberOf(request: PostingRequest): string {
    const number = request.entryNumber ?? `${request.sourceType}-${request.sourceId}`;
    if (number.length > 64) throw new PostingRuleError('INVALID_MAPPING', `شماره سند «${number.slice(0, 20)}…» از ۶۴ نویسه بلندتر است.`);
    return number;
  }

  /**
   * Reverses the voucher the engine posted for a source document (debit and credit swapped).
   * Two concurrent calls cannot both succeed: the ledger allows one reversal per entry (unique index)
   * and the loser gets its 409; marking the source row afterwards is bookkeeping only.
   */
  async reverse(tenantId: string, docType: string, sourceType: string, sourceId: string, options: { date?: string; reason?: string } = {}): Promise<PostingResult> {
    const source = await this.repository.findSource(tenantId, sourceType, sourceId, docType);
    if (!source?.entryId) throw new NotFoundException('برای این سند منبع، سند حسابداری ثبت‌شده‌ای وجود ندارد.');
    if (source.reversalEntryId) throw new ConflictException('سند حسابداری این سند منبع قبلاً برگشت خورده است.');
    const reversal = await this.accounting.reverseJournalEntry(tenantId, source.entryId, options);
    await this.repository.attachReversal(tenantId, sourceType, sourceId, docType, reversal.id);
    return { entryId: reversal.id, entryNumber: reversal.entryNumber, replayed: false };
  }

  // ------------------------------------------------------------------ settings

  /** Templates with, per role, the account in force and where it comes from. */
  async describe(tenantId: string) {
    const rows = await this.repository.listAllMappings(tenantId);
    const accounts = new Map((await this.accounting.listAccounts(tenantId)).map((a) => [a.code, a]));
    return POSTING_TEMPLATES.map((template) => {
      const mapping: Partial<Record<PostingRole, string>> = {};
      const source: Partial<Record<PostingRole, 'document' | 'all' | 'default'>> = {};
      const roles = [...new Set(template.lines.map((l) => l.role))];
      for (const role of roles) {
        const own = rows.find((r) => r.docType === template.docType && r.role === role);
        const wide = rows.find((r) => r.docType === ALL_DOC_TYPES && r.role === role);
        const code = own?.accountCode ?? wide?.accountCode ?? resolveRole(template, role);
        if (code) mapping[role] = code;
        source[role] = own ? 'document' : wide ? 'all' : 'default';
      }
      return {
        docType: template.docType,
        title: template.title,
        roles: roles.map((role) => ({
          role,
          label: POSTING_ROLES[role].label,
          types: [...POSTING_ROLES[role].types] as string[],
          accountCode: mapping[role] ?? null,
          accountName: mapping[role] ? (accounts.get(mapping[role]!)?.name ?? null) : null,
          source: source[role]!,
          valid: mapping[role] ? this.isValidTarget(role, accounts.get(mapping[role]!)) : false,
        })),
      };
    });
  }

  private isValidTarget(role: PostingRole, account: { level?: AccountLevel | null; accountType: string } | undefined): boolean {
    if (!account) return false;
    if (account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL) return false;
    return (POSTING_ROLES[role].types as readonly string[]).includes(account.accountType);
  }

  /** Saves one mapping after checking the account exists, is posting level and fits the role. */
  async setMapping(tenantId: string, docType: string, role: string, accountCode: string): Promise<void> {
    if (docType !== ALL_DOC_TYPES) requireTemplate(docType);
    if (!isPostingRole(role)) throw new PostingRuleError('INVALID_MAPPING', `نقش «${role}» شناخته‌شده نیست.`);
    const account = (await this.accounting.listAccounts(tenantId)).find((a) => a.code === accountCode);
    if (!account) throw new PostingRuleError('UNKNOWN_ACCOUNT', `حساب ${accountCode} در دفتر کل سازمان وجود ندارد.`);
    if (account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL) {
      throw new PostingRuleError('HEADER_ACCOUNT', `حساب ${accountCode} گروه یا کل است؛ فقط حساب معین یا تفصیلی قابل انتخاب است.`);
    }
    if (!this.isValidTarget(role, account)) {
      throw new PostingRuleError('INVALID_MAPPING', `حساب ${accountCode} (${account.name}) با نقش «${POSTING_ROLES[role].label}» سازگار نیست.`);
    }
    await this.repository.upsertMapping(tenantId, docType, role, accountCode);
  }

  async clearMapping(tenantId: string, docType: string, role: string): Promise<void> {
    await this.repository.deleteMapping(tenantId, docType, role);
  }

  /** Default code of a role for display (global default only). */
  static defaultFor(role: PostingRole): string | undefined {
    return DEFAULT_ROLE_ACCOUNTS[role];
  }
}
