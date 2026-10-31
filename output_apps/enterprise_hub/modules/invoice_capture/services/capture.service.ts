import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccountingService } from '../../accounting/services/accounting.service';
import { imageMimeType, sniffFileKind } from '../../data_import/parsers/file-kind';
import { parsePdf } from '../../data_import/parsers/pdf.parser';
import {
  CAPTURE_ACCOUNTS,
  CAPTURE_DEFAULT_DAILY_COST_CAP_USD,
  CAPTURE_DEFAULT_DAILY_DOC_CAP,
  CAPTURE_DEFAULT_MIN_CONFIDENCE,
  CAPTURE_ENTRY_PREFIX,
  CAPTURE_MAX_FILE_BYTES,
  CAPTURE_MAX_PDF_TEXT_CHARS,
  CAPTURE_MAX_TEXT_CHARS,
  CAPTURE_QUEUE_WINDOW_MS,
} from '../constants/capture.constants';
import { decideAuto, overallConfidence } from '../domain/confidence';
import { DraftInvoice, ExtractionResult, Finding } from '../domain/capture.types';
import { ExtractionParseError, parseExtraction } from '../domain/extraction-schema';
import { cleanText, normaliseName, normaliseTaxId, parseAmountMinor } from '../domain/normalise';
import { looksLikeInjection, redactSecrets } from '../domain/redact';
import { sniffAudio } from '../domain/source';
import { VoucherBuildError, buildVoucher } from '../domain/voucher';
import { dedupeKey, suggestAccount, validateDraft } from '../domain/validate';
import { CaptureView } from '../dto/capture-view';
import { CreateCaptureDto, UpdateDraftDto, UpdateSettingsDto, UpsertVendorRuleDto } from '../dto/capture.dto';
import {
  CaptureDocumentEntity,
  CaptureSettingsEntity,
  CaptureVendorEntity,
  CaptureVendorRuleEntity,
} from '../entities/capture.entities';
import { CaptureRepository } from '../repositories/capture.repository';
import { CaptureLlmService, LlmOutcome } from './capture-llm.service';

export interface UploadedCaptureFile {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

interface StoredExtraction {
  draft: DraftInvoice;
  transcript: string | null;
  notes: string[];
  autoReasons: string[];
}

interface Enriched {
  findings: Finding[];
  vendor: CaptureVendorEntity | null;
  rule: CaptureVendorRuleEntity | null;
  chartCodes: Set<string>;
  draft: DraftInvoice;
}

const counterparty = (d: DraftInvoice): { name: string; taxId: string } =>
  d.kind === 'purchase'
    ? { name: d.sellerName, taxId: d.sellerTaxId }
    : { name: d.buyerName, taxId: d.buyerTaxId };

/**
 * Invoice capture orchestration: upload -> extraction -> validation -> draft -> post/auto-post.
 * All money moves exclusively through `AccountingService` (exact bigint, period locks, reversal-only
 * correction). The model only ever produces DATA that passes the strict schema; it can neither
 * choose an account outside the tenant chart nor trigger any action.
 */
@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  constructor(
    private readonly repo: CaptureRepository,
    private readonly llm: CaptureLlmService,
    private readonly accounting: AccountingService,
  ) {}

  // ---------------------------------------------------------------- settings / rules

  async getSettings(tenantId: string): Promise<CaptureSettingsEntity> {
    return (
      (await this.repo.findSettings(tenantId)) ??
      Object.assign(new CaptureSettingsEntity(), {
        tenantId,
        autoEnabled: false,
        minConfidence: String(CAPTURE_DEFAULT_MIN_CONFIDENCE),
        dailyCostCapUsd: String(CAPTURE_DEFAULT_DAILY_COST_CAP_USD),
        dailyDocCap: CAPTURE_DEFAULT_DAILY_DOC_CAP,
        updatedBy: null,
      })
    );
  }

  async updateSettings(tenantId: string, actor: string, dto: UpdateSettingsDto): Promise<CaptureSettingsEntity> {
    const saved = await this.repo.saveSettings(
      Object.assign(new CaptureSettingsEntity(), {
        tenantId,
        autoEnabled: dto.autoEnabled,
        minConfidence: dto.minConfidence.toFixed(3),
        dailyCostCapUsd: dto.dailyCostCapUsd.toFixed(2),
        dailyDocCap: dto.dailyDocCap,
        updatedBy: actor,
      }),
    );
    await this.repo.addAudit({
      tenantId,
      documentId: '00000000-0000-0000-0000-000000000000',
      action: 'settings_changed',
      actor,
      sourceSha256: null,
      model: null,
      detail: { autoEnabled: dto.autoEnabled, minConfidence: dto.minConfidence },
    });
    return saved;
  }

  async upsertRule(tenantId: string, actor: string, vendorId: string, dto: UpsertVendorRuleDto): Promise<CaptureVendorRuleEntity> {
    const vendor = await this.repo.findVendor(tenantId, vendorId);
    if (!vendor) {
      throw new NotFoundException('فروشنده یافت نشد.');
    }
    const codes = await this.chartCodes(tenantId);
    if (!codes.has(dto.accountCode)) {
      throw new BadRequestException(`حساب ${dto.accountCode} در دفتر کل سازمان وجود ندارد.`);
    }
    return this.repo.saveRule(
      Object.assign(new CaptureVendorRuleEntity(), {
        vendorId,
        tenantId,
        accountCode: dto.accountCode,
        autoPost: dto.autoPost,
        maxAmountIrr: dto.maxAmountIrr,
        updatedBy: actor,
      }),
    );
  }

  async listRules(tenantId: string): Promise<Array<CaptureVendorRuleEntity & { vendorName: string }>> {
    const rules = await this.repo.listRules(tenantId);
    const vendors = await this.repo.listVendors(tenantId, rules.map((r) => r.vendorId));
    return rules.map((r) => ({ ...r, vendorName: vendors.find((v) => v.id === r.vendorId)?.name ?? '' }));
  }

  // ---------------------------------------------------------------- create

  async create(
    tenantId: string,
    actor: string,
    file: UploadedCaptureFile | undefined,
    dto: CreateCaptureDto,
  ): Promise<CaptureView> {
    const userText = (dto.text ?? '').slice(0, CAPTURE_MAX_TEXT_CHARS);
    if (!file && !userText.trim()) {
      throw new BadRequestException('تصویر، PDF، پیام صوتی یا متن فاکتور را بفرستید.');
    }
    await this.assertWithinCaps(tenantId);

    const input = await this.prepareInput(file, userText);
    const outcome = await this.runExtraction(input);

    const sha = createHash('sha256')
      .update(file ? file.buffer : Buffer.from(userText))
      .digest('hex');
    const extraction = outcome.result;
    if (dto.kind) {
      extraction.draft.kind = dto.kind;
    }
    const enriched = await this.enrich(tenantId, extraction.draft, undefined, sha);
    const confidence = overallConfidence(extraction.fieldConfidence, enriched.findings, extraction.notes);
    const settings = await this.getSettings(tenantId);

    const stored: StoredExtraction = {
      draft: enriched.draft,
      transcript: input.transcript,
      notes: extraction.notes,
      autoReasons: [],
    };
    const doc = await this.repo.saveDocument({
      tenantId,
      status: 'draft',
      sourceKind: input.kind,
      sourceSha256: sha,
      extracted: stored as unknown as Record<string, unknown>,
      edited: null,
      confidence: confidence.toFixed(3),
      fieldConfidence: extraction.fieldConfidence,
      findings: enriched.findings as unknown as Array<Record<string, unknown>>,
      model: outcome.llm.model,
      costUsd: (outcome.llm.costUsd + input.sttCostUsd).toFixed(6),
      tokensIn: outcome.llm.tokensIn,
      tokensOut: outcome.llm.tokensOut,
      vendorId: enriched.vendor?.id ?? null,
      dedupeKey: null,
      createdBy: actor,
    });
    if (file) {
      await this.repo.saveFile({
        documentId: doc.id,
        tenantId,
        mime: input.mime,
        bytes: file.buffer,
      });
    }
    await this.repo.addAudit({
      tenantId,
      documentId: doc.id,
      action: 'created',
      actor,
      sourceSha256: sha,
      model: outcome.llm.model,
      detail: { attempts: outcome.llm.attempts, costUsd: doc.costUsd, sourceKind: input.kind },
    });

    // Auto mode: off unless an admin enabled it AND the vendor has an auto rule AND every gate holds.
    const decision = decideAuto({
      autoEnabled: settings.autoEnabled,
      minConfidence: Number(settings.minConfidence),
      rule: enriched.rule ? { autoPost: enriched.rule.autoPost, maxAmountIrr: enriched.rule.maxAmountIrr } : null,
      confidence,
      findings: enriched.findings,
      totalMinor: parseAmountMinor(enriched.draft.total) ?? 0n,
      maxMinor: enriched.rule ? parseAmountMinor(enriched.rule.maxAmountIrr) : null,
      injectionSuspected: extraction.notes.includes('INJECTION_SUSPECTED'),
    });
    if (decision.auto) {
      try {
        await this.postDocument(doc, 'auto', 'auto_posted');
      } catch (error) {
        this.logger.warn(`auto-post failed for ${doc.id}: ${(error as Error).message}`);
        stored.autoReasons = ['AUTO_POST_FAILED'];
        await this.repo.transition(tenantId, doc.id, ['draft'], {
          status: 'needs_review',
          extracted: stored as unknown as Record<string, unknown>,
        });
      }
    } else if (settings.autoEnabled) {
      stored.autoReasons = decision.reasons;
      await this.repo.transition(tenantId, doc.id, ['draft'], {
        status: 'needs_review',
        extracted: stored as unknown as Record<string, unknown>,
      });
    }
    return this.view(tenantId, doc.id);
  }

  // ---------------------------------------------------------------- read / edit

  async view(tenantId: string, id: string): Promise<CaptureView> {
    const doc = await this.mustFind(tenantId, id);
    const stored = doc.extracted as unknown as StoredExtraction;
    const draft = ((doc.edited as unknown as DraftInvoice | null) ?? stored.draft) as DraftInvoice;
    const settled = doc.status === 'posted' || doc.status === 'auto_posted' || doc.status === 'reversed';
    const enriched = settled
      ? null
      : await this.enrich(tenantId, draft, doc.id, doc.sourceSha256);
    const findings = settled ? ((doc.findings as unknown as Finding[]) ?? []) : (enriched as Enriched).findings;
    let voucher = null;
    if (!findings.some((f) => f.severity === 'error')) {
      try {
        voucher = buildVoucher(draft, CAPTURE_ACCOUNTS.defaultExpense);
      } catch (error) {
        if (!(error instanceof VoucherBuildError)) {
          throw error;
        }
      }
    }
    const party = counterparty(draft);
    const vendor = enriched?.vendor ?? (doc.vendorId ? await this.repo.findVendor(tenantId, doc.vendorId) : null);
    const rule = enriched?.rule ?? (vendor ? await this.repo.findRule(tenantId, vendor.id) : null);
    return {
      id: doc.id,
      status: doc.status,
      sourceKind: doc.sourceKind,
      confidence: Number(doc.confidence),
      fieldConfidence: doc.fieldConfidence,
      draft,
      findings,
      voucher,
      vendor: { id: vendor?.id ?? null, name: vendor?.name ?? party.name, isNew: !vendor, autoPost: rule?.autoPost ?? false },
      model: doc.model,
      costUsd: Number(doc.costUsd),
      entryNumber: doc.entryNumber,
      journalEntryId: doc.journalEntryId,
      postedBy: doc.postedBy,
      autoReasons: stored.autoReasons ?? [],
      sourceUrl: `/enterprise-hub/assistant/capture/documents/${doc.id}/source`,
      transcript: stored.transcript,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async source(tenantId: string, id: string): Promise<{ mime: string; bytes: Buffer }> {
    await this.mustFind(tenantId, id);
    const file = await this.repo.findFile(tenantId, id);
    if (!file) {
      throw new NotFoundException('فایل منبع ندارد.');
    }
    return { mime: file.mime, bytes: file.bytes };
  }

  async update(tenantId: string, actor: string, id: string, dto: UpdateDraftDto): Promise<CaptureView> {
    const doc = await this.mustFind(tenantId, id);
    if (doc.status !== 'draft' && doc.status !== 'needs_review') {
      throw new ConflictException('این سند دیگر قابل ویرایش نیست.');
    }
    const draft: DraftInvoice = {
      kind: dto.kind,
      sellerName: cleanText(dto.sellerName),
      sellerTaxId: normaliseTaxId(dto.sellerTaxId),
      buyerName: cleanText(dto.buyerName),
      buyerTaxId: normaliseTaxId(dto.buyerTaxId),
      invoiceNumber: cleanText(dto.invoiceNumber, 64),
      date: dto.date,
      currency: dto.currency,
      fxRate: dto.fxRate ?? null,
      items: dto.items.map((i) => ({
        description: cleanText(i.description),
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        accountCode: i.accountCode ? i.accountCode : null,
      })),
      subtotal: dto.subtotal,
      tax: dto.tax,
      total: dto.total,
      paid: dto.paid,
      notes: cleanText(dto.notes ?? '', 500),
    };
    const enriched = await this.enrich(tenantId, draft, id, doc.sourceSha256);
    const stored = doc.extracted as unknown as StoredExtraction;
    const confidence = overallConfidence(doc.fieldConfidence, enriched.findings, stored.notes ?? []);
    const ok = await this.repo.transition(tenantId, id, ['draft', 'needs_review'], {
      edited: enriched.draft as unknown as Record<string, unknown>,
      findings: enriched.findings as unknown as Array<Record<string, unknown>>,
      confidence: confidence.toFixed(3),
      vendorId: enriched.vendor?.id ?? null,
    });
    if (!ok) {
      throw new ConflictException('این سند دیگر قابل ویرایش نیست.');
    }
    await this.repo.addAudit({
      tenantId,
      documentId: id,
      action: 'edited',
      actor,
      sourceSha256: doc.sourceSha256,
      model: null,
      detail: {},
    });
    return this.view(tenantId, id);
  }

  async reject(tenantId: string, actor: string, id: string): Promise<CaptureView> {
    const doc = await this.mustFind(tenantId, id);
    const ok = await this.repo.transition(tenantId, id, ['draft', 'needs_review'], {
      status: 'rejected',
      reviewedAt: new Date(),
    });
    if (!ok) {
      throw new ConflictException('فقط پیش‌نویس رد می‌شود؛ سند ثبت‌شده با سند برگشتی اصلاح می‌شود.');
    }
    await this.repo.addAudit({
      tenantId, documentId: id, action: 'rejected', actor,
      sourceSha256: doc.sourceSha256, model: null, detail: {},
    });
    return this.view(tenantId, id);
  }

  // ---------------------------------------------------------------- post / reverse

  /** One-click post of a reviewed draft. Posts through `AccountingService` only. */
  async post(tenantId: string, actor: string, id: string): Promise<CaptureView> {
    const doc = await this.mustFind(tenantId, id);
    if (doc.status === 'posted' || doc.status === 'auto_posted') {
      return this.view(tenantId, id);
    }
    if (doc.status !== 'draft' && doc.status !== 'needs_review') {
      throw new ConflictException('این سند قابل ثبت نیست.');
    }
    await this.postDocument(doc, actor, 'posted');
    return this.view(tenantId, id);
  }

  private async postDocument(
    doc: CaptureDocumentEntity,
    actor: string,
    finalStatus: 'posted' | 'auto_posted',
  ): Promise<void> {
    const tenantId = doc.tenantId;
    const stored = doc.extracted as unknown as StoredExtraction;
    const draft = ((doc.edited as unknown as DraftInvoice | null) ?? stored.draft) as DraftInvoice;
    const enriched = await this.enrich(tenantId, draft, doc.id, doc.sourceSha256);
    const errors = enriched.findings.filter((f) => f.severity === 'error');
    if (errors.length > 0) {
      throw new ConflictException({ message: 'سند خطا دارد و ثبت نشد.', findings: errors });
    }
    const voucher = buildVoucher(enriched.draft, CAPTURE_ACCOUNTS.defaultExpense);
    const entryNumber = `${CAPTURE_ENTRY_PREFIX}-${voucher.date.replace(/-/g, '')}-${doc.id.slice(0, 8)}`;

    let journalId: number;
    try {
      const entry = await this.accounting.createJournalEntry(tenantId, {
        entryNumber,
        date: `${voucher.date}T00:00:00.000Z`,
        description: voucher.description,
        lines: voucher.lines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          partyCode: l.partyCode,
        })),
      });
      journalId = entry.id;
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
      // Same document posted before (crash after posting, or a double click): link, do not repost.
      const existing = await this.accounting.findJournalEntryByNumber(tenantId, entryNumber);
      if (!existing) {
        throw error;
      }
      journalId = existing.id;
    }

    const vendor = await this.ensureVendor(tenantId, enriched.draft, enriched.vendor);
    const key = dedupeKey(enriched.draft, normaliseName(counterparty(enriched.draft).name));
    const moved = await this.repo.transition(tenantId, doc.id, ['draft', 'needs_review'], {
      status: finalStatus,
      journalEntryId: journalId,
      entryNumber,
      postedBy: actor,
      postedAt: new Date(),
      dedupeKey: key,
      vendorId: vendor.id,
      edited: enriched.draft as unknown as Record<string, unknown>,
      findings: enriched.findings as unknown as Array<Record<string, unknown>>,
    });
    if (!moved) {
      return;
    }
    await this.learnAccounts(vendor, enriched.draft);
    await this.repo.addAudit({
      tenantId,
      documentId: doc.id,
      action: finalStatus === 'auto_posted' ? 'auto_posted' : 'posted',
      actor,
      sourceSha256: doc.sourceSha256,
      model: doc.model,
      detail: { entryNumber, journalEntryId: journalId, confidence: Number(doc.confidence) },
    });
  }

  /** The ONLY correction of a posted document: a reversing entry (the original is never edited). */
  async reverse(tenantId: string, actor: string, id: string, reason?: string): Promise<CaptureView> {
    const doc = await this.mustFind(tenantId, id);
    if ((doc.status !== 'posted' && doc.status !== 'auto_posted') || !doc.journalEntryId) {
      throw new ConflictException('فقط سند ثبت‌شده برگشت می‌خورد.');
    }
    const reversal = await this.accounting.reverseJournalEntry(tenantId, doc.journalEntryId, {
      reason: reason ?? `برگشت فاکتور ${doc.entryNumber}`,
    });
    await this.repo.transition(tenantId, id, ['posted', 'auto_posted'], {
      status: 'reversed',
      reversalEntryId: reversal.id,
      reviewedAt: new Date(),
    });
    await this.repo.addAudit({
      tenantId, documentId: id, action: 'reversed', actor,
      sourceSha256: doc.sourceSha256, model: doc.model,
      detail: { reversalEntryId: reversal.id, reason: reason ?? null },
    });
    return this.view(tenantId, id);
  }

  // ---------------------------------------------------------------- queue

  /** Daily review queue: flagged drafts + everything auto-posted in the last 24 h not yet reviewed. */
  async queue(tenantId: string): Promise<CaptureView[]> {
    const rows = await this.repo.listQueue(tenantId, new Date(Date.now() - CAPTURE_QUEUE_WINDOW_MS));
    return Promise.all(rows.map((r) => this.view(tenantId, r.id)));
  }

  async markReviewed(tenantId: string, actor: string, id: string): Promise<CaptureView> {
    const doc = await this.mustFind(tenantId, id);
    if (!doc.reviewedAt) {
      await this.repo.transition(tenantId, id, [doc.status], { reviewedAt: new Date() });
      await this.repo.addAudit({
        tenantId, documentId: id, action: 'reviewed', actor,
        sourceSha256: doc.sourceSha256, model: null, detail: {},
      });
    }
    return this.view(tenantId, id);
  }

  async recent(tenantId: string): Promise<CaptureView[]> {
    const rows = await this.repo.listRecent(tenantId, 30);
    return Promise.all(rows.map((r) => this.view(tenantId, r.id)));
  }

  // ---------------------------------------------------------------- internals

  private async mustFind(tenantId: string, id: string): Promise<CaptureDocumentEntity> {
    const doc = await this.repo.findDocument(tenantId, id);
    if (!doc) {
      throw new NotFoundException('سند یافت نشد.');
    }
    return doc;
  }

  private async chartCodes(tenantId: string): Promise<Set<string>> {
    return new Set((await this.accounting.listAccounts(tenantId)).map((a) => a.code));
  }

  private async assertWithinCaps(tenantId: string): Promise<void> {
    const settings = await this.getSettings(tenantId);
    const usage = await this.repo.usageSince(tenantId, new Date(Date.now() - 24 * 60 * 60 * 1000));
    if (usage.costUsd >= Number(settings.dailyCostCapUsd) || usage.documents >= settings.dailyDocCap) {
      throw new HttpException(
        'سقف هزینه یا تعداد روزانه استخراج فاکتور سازمان پر شده است.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async prepareInput(
    file: UploadedCaptureFile | undefined,
    userText: string,
  ): Promise<{
    kind: 'image' | 'pdf' | 'voice' | 'text';
    mime: string;
    text: string;
    images: Array<{ mimeType: string; base64: string }>;
    transcript: string | null;
    sttCostUsd: number;
  }> {
    const base = { images: [] as Array<{ mimeType: string; base64: string }>, transcript: null as string | null, sttCostUsd: 0 };
    if (!file) {
      return { ...base, kind: 'text', mime: 'text/plain', text: redactSecrets(userText) };
    }
    if (file.buffer.length === 0 || file.buffer.length > CAPTURE_MAX_FILE_BYTES) {
      throw new BadRequestException('حجم فایل نامعتبر است (حداکثر ۸ مگابایت).');
    }
    const kind = sniffFileKind(file.buffer, file.originalname ?? '', file.mimetype ?? '');
    if (kind === 'image') {
      const mime = imageMimeType(file.buffer) ?? 'image/jpeg';
      return {
        ...base,
        kind: 'image',
        mime,
        text: redactSecrets(userText),
        images: [{ mimeType: mime, base64: file.buffer.toString('base64') }],
      };
    }
    if (kind === 'pdf') {
      let pdfText: string;
      try {
        const table = parsePdf(file.buffer);
        pdfText = [table.headers, ...table.rows].map((row) => row.join(' | ')).join('\n');
      } catch {
        throw new UnprocessableEntityException(
          'متن این PDF قابل استخراج نیست (احتمالاً اسکن است). عکس فاکتور را بفرستید.',
        );
      }
      const joined = `${pdfText.slice(0, CAPTURE_MAX_PDF_TEXT_CHARS)}\n${userText}`;
      return { ...base, kind: 'pdf', mime: 'application/pdf', text: redactSecrets(joined) };
    }
    const audio = sniffAudio(file.buffer);
    if (audio) {
      const stt = await this.llm.transcribe(file.buffer, audio);
      return {
        ...base,
        kind: 'voice',
        mime: `audio/${audio}`,
        text: redactSecrets(`${stt.content}\n${userText}`),
        transcript: redactSecrets(stt.content),
        sttCostUsd: stt.costUsd,
      };
    }
    throw new BadRequestException('نوع فایل پشتیبانی نمی‌شود (تصویر، PDF یا پیام صوتی).');
  }

  private async runExtraction(input: {
    text: string;
    images: Array<{ mimeType: string; base64: string }>;
  }): Promise<{ llm: LlmOutcome; result: ExtractionResult }> {
    let parsed: ExtractionResult | null = null;
    const llm = await this.llm.extract(
      { text: input.text || undefined, images: input.images },
      (content) => {
        try {
          parsed = parseExtraction(content, input.text);
        } catch (error) {
          if (error instanceof ExtractionParseError) {
            throw error;
          }
          throw new ExtractionParseError((error as Error).message);
        }
      },
    );
    if (!parsed) {
      throw new UnprocessableEntityException('پاسخ مدل قابل استفاده نبود.');
    }
    return { llm, result: parsed };
  }

  /** Vendor lookup, account suggestion, duplicate + period-lock facts, then the pure validation. */
  private async enrich(
    tenantId: string,
    input: DraftInvoice,
    excludeId: string | undefined,
    sha: string,
  ): Promise<Enriched> {
    const draft: DraftInvoice = { ...input, items: input.items.map((i) => ({ ...i })) };
    const chartCodes = await this.chartCodes(tenantId);
    const party = counterparty(draft);
    const normalized = normaliseName(party.name);
    const taxId = normaliseTaxId(party.taxId);
    const vendor =
      (taxId ? await this.repo.findVendorByTaxId(tenantId, taxId) : null) ??
      (normalized ? await this.repo.findVendorByName(tenantId, normalized) : null);
    const rule = vendor ? await this.repo.findRule(tenantId, vendor.id) : null;

    for (const item of draft.items) {
      if (!item.accountCode) {
        item.accountCode = suggestAccount({
          kind: draft.kind,
          description: item.description,
          vendorRuleCode: rule?.accountCode,
          vendorHits: vendor?.accountHits,
          chartCodes,
        });
      }
    }

    const key = dedupeKey(draft, normalized);
    const dupByKey = key ? await this.repo.findPostedByDedupeKey(tenantId, key, excludeId) : null;
    const dupBySha = dupByKey ? null : await this.repo.findPostedBySha(tenantId, sha, excludeId);
    const periodLocked = draft.date
      ? await this.accounting.isPeriodLocked(tenantId, new Date(`${draft.date}T00:00:00.000Z`))
      : false;

    const findings = validateDraft(draft, {
      duplicateOfDocumentId: (dupByKey ?? dupBySha)?.id ?? null,
      periodLocked,
      chartCodes,
    });
    if (draft.items.some((i) => !i.accountCode)) {
      findings.push({ severity: 'error', code: 'ACCOUNT_UNRESOLVED', message: 'برای برخی ردیف‌ها حساب مناسبی پیدا نشد؛ حساب را انتخاب کنید.' });
    }
    return { findings, vendor, rule, chartCodes, draft };
  }

  private async ensureVendor(
    tenantId: string,
    draft: DraftInvoice,
    existing: CaptureVendorEntity | null,
  ): Promise<CaptureVendorEntity> {
    if (existing) {
      return existing;
    }
    const party = counterparty(draft);
    return this.repo.saveVendor({
      tenantId,
      name: party.name,
      normalizedName: normaliseName(party.name),
      taxId: normaliseTaxId(party.taxId) || null,
      accountHits: {},
    });
  }

  /** Learn the tenant's account history: counts per chart code used with this vendor. */
  private async learnAccounts(vendor: CaptureVendorEntity, draft: DraftInvoice): Promise<void> {
    const hits = { ...(vendor.accountHits ?? {}) };
    for (const item of draft.items) {
      if (item.accountCode) {
        hits[item.accountCode] = (hits[item.accountCode] ?? 0) + 1;
      }
    }
    await this.repo.saveVendor({ ...vendor, accountHits: hits });
  }
}
