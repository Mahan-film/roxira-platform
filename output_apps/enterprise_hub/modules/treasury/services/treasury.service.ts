import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MoneyFormatError, fromDb, fromMinor, minorToDecimal, toMinor } from '../../accounting/money';
import { BankingService } from '../../banking/services/banking.service';
import { ChequeDirection } from '../../cheques/enums/cheque.enum';
import { ChequesService } from '../../cheques/services/cheques.service';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { InvoiceDirection } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import {
  AllocationError,
  AllocationRequest,
  OpenItem,
  planAllocation,
} from '../allocation/allocation-engine';
import { TREASURY_ACCOUNTS } from '../constants/treasury.constants';
import {
  AllocateAdvanceDto,
  AllocationReportRowDto,
  AllocationRowDto,
  CreateTreasuryDocumentDto,
  OpenInvoiceResponseDto,
  QueryAllocationsDto,
  QueryTreasuryDocumentsDto,
  TreasuryAllocationResponseDto,
  TreasuryDocumentDetailResponseDto,
  TreasuryDocumentResponseDto,
  TreasuryLineResponseDto,
} from '../dto/treasury.dto';
import { TreasuryAllocationEntity } from '../entities/treasury-allocation.entity';
import { TreasuryDocumentLineEntity } from '../entities/treasury-document-line.entity';
import { TreasuryDocumentEntity } from '../entities/treasury-document.entity';
import { TreasuryDocKind, TreasuryDocStatus, TreasuryMethod } from '../enums/treasury.enum';
import { FundLine } from '../posting/treasury-lines';
import { TREASURY_POSTING, TreasuryPostingPort } from '../posting/treasury-posting.port';
import { LineInput, TreasuryRepository } from '../repositories/treasury.repository';

const dateOnly = (value: string): string => value.slice(0, 10);
const todayUtc = (): string => new Date().toISOString().slice(0, 10);
const PREFIX: Record<TreasuryDocKind, string> = { [TreasuryDocKind.RECEIPT]: 'RC', [TreasuryDocKind.PAYMENT]: 'PY' };

interface InvoiceFacts {
  id: string;
  number: string;
  payable: bigint;
}

function amountOf(value: number | string, label: string): bigint {
  try {
    return toMinor(value);
  } catch (error) {
    if (error instanceof MoneyFormatError) throw new BadRequestException(`${label}: ${error.message}`);
    throw error;
  }
}

/**
 * Receipts and payments (دریافت و پرداخت) with settlement against invoices.
 *
 * One document, one transaction: number, document, method lines, allocation rows and the journal
 * entry are written together, so a failed posting leaves nothing behind. Cheque lines are the one
 * exception: `ChequesService.create` opens its own transaction (and posts its own entry), so
 * cheques are registered after every other validation has passed and before the document
 * transaction. Money amounts are integer minor units (`money.ts`); allocation rules live in
 * `allocation-engine.ts`; every ledger detail is behind `TreasuryPostingPort`.
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly repository: TreasuryRepository,
    @Inject(TREASURY_POSTING) private readonly posting: TreasuryPostingPort,
    private readonly bankingService: BankingService,
    private readonly chequesService: ChequesService,
    private readonly invoicingService: InvoicingService,
  ) {}

  // ------------------------------------------------------------------ documents

  async createDocument(tenantId: string, dto: CreateTreasuryDocumentDto): Promise<TreasuryDocumentDetailResponseDto> {
    const kind = dto.kind;
    const docDate = dateOnly(dto.docDate);
    const methods = dto.methods.map((m) => ({ ...m, minor: amountOf(m.amount, 'مبلغ') }));
    if (methods.some((m) => m.minor <= 0n)) throw new BadRequestException('مبلغ هر روش پرداخت باید بزرگ‌تر از صفر باشد.');
    const total = methods.reduce((sum, m) => sum + m.minor, 0n);

    const bankCodes = await this.bankLedgerCodes(tenantId, methods.map((m) => ({ method: m.method, bankAccountId: m.bankAccountId })));
    for (const m of methods) {
      if (m.method === TreasuryMethod.CHEQUE && (!m.chequeNumber || !m.dueDate)) {
        throw new BadRequestException('برای چک، شماره چک و تاریخ سررسید لازم است.');
      }
    }

    const requests = this.requestsOf(dto.allocations ?? []);
    const invoices = await this.loadInvoices(tenantId, kind, requests.map((r) => r.targetId));
    const tolerance = fromDb(await this.repository.getTolerance(tenantId));

    // Dry run with the figures read now: rejects bad input before any cheque is registered. The
    // real check repeats inside the transaction under the invoice locks.
    this.plan(total, requests, await this.outstanding(tenantId, invoices, undefined), tolerance);

    const chequeIds = new Map<number, number>();
    for (const [index, m] of methods.entries()) {
      if (m.method !== TreasuryMethod.CHEQUE) continue;
      const cheque = await this.chequesService.create(tenantId, {
        direction: kind === TreasuryDocKind.RECEIPT ? ChequeDirection.RECEIVED : ChequeDirection.ISSUED,
        sayadNumber: m.sayadNumber,
        chequeNumber: m.chequeNumber as string,
        bankName: m.chequeBankName,
        amount: m.amount,
        issueDate: docDate,
        dueDate: m.dueDate as string,
        partyName: dto.partyName,
        partyCode: dto.partyCode,
        description: dto.description,
      });
      chequeIds.set(index, cheque.id);
    }

    const saved = await this.repository.runInTransaction(tenantId, async (manager) => {
      await this.repository.lockTargets(tenantId, requests.map((r) => r.targetId), manager);
      const plan = this.plan(total, requests, await this.outstanding(tenantId, invoices, manager), tolerance);

      const number = await this.repository.nextNumber(tenantId, kind, manager);
      const docNumber = `${PREFIX[kind]}-${String(number).padStart(6, '0')}`;
      const document = await this.repository.createDocument(
        tenantId,
        {
          kind,
          docNumber,
          docDate,
          partyType: dto.partyType,
          partyCode: dto.partyCode,
          partyName: dto.partyName,
          total: minorToDecimal(total),
          writeoffTotal: minorToDecimal(plan.writeoffTotal),
          advanceRemaining: minorToDecimal(plan.advance),
          description: dto.description ?? null,
        },
        manager,
      );
      const lines: LineInput[] = methods.map((m, index) => ({
        method: m.method,
        amount: minorToDecimal(m.minor),
        bankAccountId: m.bankAccountId ?? null,
        cashBoxId: m.cashBoxId ?? null,
        chequeId: chequeIds.get(index) ?? null,
        reference: m.reference ?? null,
      }));
      await this.repository.addLines(tenantId, document.id, lines, manager);

      const funds: FundLine[] = [];
      let chequeTotal = 0n;
      for (const m of methods) {
        if (m.method === TreasuryMethod.CHEQUE) chequeTotal += m.minor;
        else funds.push({ accountCode: this.fundAccount(m.method, m.bankAccountId, bankCodes), amount: m.minor });
      }
      const journalEntryId = await this.posting.postDocument(
        tenantId,
        { docNumber, date: docDate, description: this.describe(kind, docNumber, dto.partyName) },
        {
          kind,
          partyCode: dto.partyCode,
          funds,
          chequeTotal,
          applied: plan.applied,
          writeoff: plan.writeoffTotal,
          advance: plan.advance,
        },
        manager,
      );
      await this.repository.updateDocument(tenantId, document.id, { journalEntryId }, manager);
      await this.repository.addAllocations(
        tenantId,
        document.id,
        plan.rows.map((row) => ({
          targetId: row.targetId,
          targetNumber: invoices.get(row.targetId)?.number ?? null,
          amount: minorToDecimal(row.amount),
          writeoff: minorToDecimal(row.writeoff),
          allocatedDate: docDate,
          journalEntryId: null,
        })),
        manager,
      );
      return document.id;
    });
    return this.getDocument(tenantId, saved);
  }

  /** Moves the unallocated part of a document (an advance) onto invoices. */
  async allocateAdvance(
    tenantId: string,
    documentId: number,
    dto: AllocateAdvanceDto,
  ): Promise<TreasuryDocumentDetailResponseDto> {
    const date = dto.date ? dateOnly(dto.date) : todayUtc();
    const requests = this.requestsOf(dto.allocations);
    const probe = await this.repository.findDocument(tenantId, documentId);
    if (!probe) throw new NotFoundException('سند دریافت/پرداخت یافت نشد.');
    const invoices = await this.loadInvoices(tenantId, probe.kind, requests.map((r) => r.targetId));
    const tolerance = fromDb(await this.repository.getTolerance(tenantId));

    await this.repository.runInTransaction(tenantId, async (manager) => {
      const document = await this.repository.findDocumentForUpdate(tenantId, documentId, manager);
      if (!document) throw new NotFoundException('سند دریافت/پرداخت یافت نشد.');
      if (document.status !== TreasuryDocStatus.POSTED) {
        throw new BadRequestException('این سند ابطال شده و قابل تخصیص نیست.');
      }
      await this.repository.lockTargets(tenantId, requests.map((r) => r.targetId), manager);
      const plan = this.plan(
        fromDb(document.advanceRemaining),
        requests,
        await this.outstanding(tenantId, invoices, manager),
        tolerance,
      );
      const journalEntryId = await this.posting.postAdvanceAllocation(
        tenantId,
        {
          docNumber: document.docNumber,
          date,
          description: `تخصیص ${document.kind === TreasuryDocKind.RECEIPT ? 'پیش‌دریافت' : 'پیش‌پرداخت'} ${document.docNumber} — ${document.partyName}`,
        },
        { kind: document.kind, partyCode: document.partyCode, applied: plan.applied, writeoff: plan.writeoffTotal },
        manager,
      );
      await this.repository.addAllocations(
        tenantId,
        documentId,
        plan.rows.map((row) => ({
          targetId: row.targetId,
          targetNumber: invoices.get(row.targetId)?.number ?? null,
          amount: minorToDecimal(row.amount),
          writeoff: minorToDecimal(row.writeoff),
          allocatedDate: date,
          journalEntryId,
        })),
        manager,
      );
      await this.repository.updateDocument(
        tenantId,
        documentId,
        {
          advanceRemaining: minorToDecimal(plan.advance),
          writeoffTotal: minorToDecimal(fromDb(document.writeoffTotal) + plan.writeoffTotal),
        },
        manager,
      );
    });
    return this.getDocument(tenantId, documentId);
  }

  async getDocument(tenantId: string, id: number): Promise<TreasuryDocumentDetailResponseDto> {
    const document = await this.repository.findDocument(tenantId, id);
    if (!document) throw new NotFoundException('سند دریافت/پرداخت یافت نشد.');
    const [lines, allocations] = await Promise.all([
      this.repository.listLines(tenantId, id),
      this.repository.listAllocationsOfDocument(tenantId, id),
    ]);
    return {
      ...this.toDto(document),
      methods: lines.map((l) => this.lineDto(l)),
      allocations: allocations.map((a) => this.allocationDto(a)),
    };
  }

  async listDocuments(tenantId: string, query: QueryTreasuryDocumentsDto): Promise<TreasuryDocumentResponseDto[]> {
    const rows = await this.repository.listDocuments(tenantId, {
      kind: query.kind,
      partyCode: query.partyCode,
      from: query.from ? dateOnly(query.from) : undefined,
      to: query.to ? dateOnly(query.to) : undefined,
    });
    return rows.map((row) => this.toDto(row));
  }

  // ------------------------------------------------------------------ settings and public reads

  async getTolerance(tenantId: string): Promise<{ writeoffTolerance: number | string }> {
    return { writeoffTolerance: fromMinor(fromDb(await this.repository.getTolerance(tenantId))) };
  }

  async setTolerance(tenantId: string, value: number | string): Promise<{ writeoffTolerance: number | string }> {
    const minor = amountOf(value, 'سقف تخفیف');
    await this.repository.setTolerance(tenantId, minorToDecimal(minor));
    return this.getTolerance(tenantId);
  }

  /** Open amount (payable minus allocations) of the given invoices or party's open invoices, for the allocation grid. */
  async openInvoices(
    tenantId: string,
    kind: TreasuryDocKind,
    invoiceIds: string[],
    partyCode?: string,
  ): Promise<OpenInvoiceResponseDto[]> {
    let invoices: Map<string, InvoiceFacts>;
    if (invoiceIds && invoiceIds.length > 0) {
      invoices = await this.loadInvoices(tenantId, kind, invoiceIds);
    } else {
      const wanted = kind === TreasuryDocKind.RECEIPT ? InvoiceDirection.SALE : InvoiceDirection.PURCHASE;
      const res = await this.invoicingService.findAll(tenantId, {
        page: 1,
        limit: 100,
        status: InvoiceStatus.ISSUED,
        direction: wanted,
      });
      invoices = new Map<string, InvoiceFacts>();
      for (const inv of res.data) {
        const party = kind === TreasuryDocKind.RECEIPT ? inv.buyerInfo : inv.sellerInfo;
        if (partyCode && party?.partyCode && party.partyCode !== partyCode) {
          continue;
        }
        invoices.set(inv.id, {
          id: inv.id,
          number: inv.taxInvoiceNumber,
          payable: amountOf(inv.finalPayable, 'مبلغ صورتحساب'),
        });
      }
    }
    const open = await this.outstanding(tenantId, invoices, undefined);
    return open
      .filter((item) => (invoiceIds && invoiceIds.length > 0) || item.outstanding > 0n)
      .map((item) => ({
        invoiceId: item.targetId,
        invoiceNumber: invoices.get(item.targetId)?.number ?? item.targetId,
        outstanding: fromMinor(item.outstanding),
        total: fromMinor(invoices.get(item.targetId)?.payable ?? 0n),
        remainingAmount: fromMinor(item.outstanding),
      }));
  }

  /**
   * Public read for ageing and party statements: the real allocation of each payment to each
   * invoice (replaces ageing by FIFO on document date; see the claude-win issue for ageing).
   */
  async listAllocations(tenantId: string, query: QueryAllocationsDto): Promise<AllocationReportRowDto[]> {
    const rows = await this.repository.listAllocations(tenantId, {
      partyCode: query.partyCode,
      asOf: query.asOf ? dateOnly(query.asOf) : undefined,
    });
    return rows.map((r) => ({
      documentId: r.documentId,
      docNumber: r.docNumber,
      kind: r.kind,
      partyCode: r.partyCode,
      invoiceId: r.targetId,
      invoiceNumber: r.targetNumber,
      amount: fromMinor(fromDb(r.amount)),
      writeoff: fromMinor(fromDb(r.writeoff)),
      allocatedDate: r.allocatedDate,
    }));
  }

  // ------------------------------------------------------------------ internals

  private requestsOf(rows: AllocationRowDto[]): AllocationRequest[] {
    return rows.map((row) => ({
      targetId: row.invoiceId,
      amount: amountOf(row.amount, 'مبلغ تخصیص'),
      writeoff: row.writeoff === undefined ? 0n : amountOf(row.writeoff, 'تخفیف'),
    }));
  }

  private plan(available: bigint, requests: AllocationRequest[], items: OpenItem[], tolerance: bigint) {
    try {
      return planAllocation({ available, items, requests, tolerance });
    } catch (error) {
      if (error instanceof AllocationError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Invoices of the right direction that are open for settlement; others are rejected. */
  private async loadInvoices(tenantId: string, kind: TreasuryDocKind, ids: string[]): Promise<Map<string, InvoiceFacts>> {
    const wanted = kind === TreasuryDocKind.RECEIPT ? InvoiceDirection.SALE : InvoiceDirection.PURCHASE;
    const found = new Map<string, InvoiceFacts>();
    for (const id of new Set(ids)) {
      const invoice = await this.invoicingService.findOne(tenantId, id);
      if (invoice.direction !== wanted) {
        throw new BadRequestException(
          kind === TreasuryDocKind.RECEIPT ? 'دریافت فقط به فاکتور فروش تخصیص می‌یابد.' : 'پرداخت فقط به فاکتور خرید تخصیص می‌یابد.',
        );
      }
      if (invoice.status !== InvoiceStatus.ISSUED) {
        throw new BadRequestException(`صورتحساب ${invoice.taxInvoiceNumber} صادر نشده یا قبلاً بسته/ابطال شده است.`);
      }
      found.set(id, { id, number: invoice.taxInvoiceNumber, payable: amountOf(invoice.finalPayable, 'مبلغ صورتحساب') });
    }
    return found;
  }

  private async outstanding(
    tenantId: string,
    invoices: Map<string, InvoiceFacts>,
    manager: EntityManager | undefined,
  ): Promise<OpenItem[]> {
    const ids = [...invoices.keys()];
    const allocated = manager
      ? await this.repository.allocatedByTarget(tenantId, ids, manager)
      : await this.repository.runInTransaction(tenantId, (m) => this.repository.allocatedByTarget(tenantId, ids, m));
    return ids.map((id) => ({
      targetId: id,
      outstanding: (invoices.get(id) as InvoiceFacts).payable - fromDb(allocated.get(id) ?? '0'),
    }));
  }

  private async bankLedgerCodes(
    tenantId: string,
    lines: Array<{ method: TreasuryMethod; bankAccountId?: number }>,
  ): Promise<Map<number, string>> {
    const needed = lines.filter((l) => l.method === TreasuryMethod.BANK_TRANSFER || l.method === TreasuryMethod.CARD);
    if (needed.length === 0) return new Map();
    if (needed.some((l) => !l.bankAccountId)) {
      throw new BadRequestException('برای انتقال بانکی و کارت، حساب بانکی لازم است.');
    }
    const accounts = await this.bankingService.listAccounts(tenantId);
    const byId = new Map(accounts.map((a) => [a.id, a.ledgerAccountCode]));
    for (const l of needed) {
      if (!byId.has(l.bankAccountId as number)) throw new BadRequestException('حساب بانکی یافت نشد.');
    }
    return byId;
  }

  private fundAccount(method: TreasuryMethod, bankAccountId: number | undefined, bankCodes: Map<number, string>): string {
    if (method === TreasuryMethod.CASH) return TREASURY_ACCOUNTS.CASH;
    return bankCodes.get(bankAccountId as number) ?? TREASURY_ACCOUNTS.BANK;
  }

  private describe(kind: TreasuryDocKind, docNumber: string, partyName: string): string {
    return `${kind === TreasuryDocKind.RECEIPT ? 'دریافت از' : 'پرداخت به'} ${partyName} — سند ${docNumber}`;
  }

  private toDto(d: TreasuryDocumentEntity): TreasuryDocumentResponseDto {
    return {
      id: d.id,
      kind: d.kind,
      docNumber: d.docNumber,
      docDate: d.docDate,
      partyType: d.partyType,
      partyCode: d.partyCode,
      partyName: d.partyName,
      total: fromMinor(fromDb(d.total)),
      writeoffTotal: fromMinor(fromDb(d.writeoffTotal)),
      advanceRemaining: fromMinor(fromDb(d.advanceRemaining)),
      description: d.description,
      status: d.status,
      journalEntryId: d.journalEntryId,
    };
  }

  private lineDto(l: TreasuryDocumentLineEntity): TreasuryLineResponseDto {
    return {
      id: l.id,
      method: l.method,
      amount: fromMinor(fromDb(l.amount)),
      bankAccountId: l.bankAccountId,
      cashBoxId: l.cashBoxId,
      chequeId: l.chequeId,
      reference: l.reference,
    };
  }

  private allocationDto(a: TreasuryAllocationEntity): TreasuryAllocationResponseDto {
    return {
      id: a.id,
      invoiceId: a.targetId,
      invoiceNumber: a.targetNumber,
      amount: fromMinor(fromDb(a.amount)),
      writeoff: fromMinor(fromDb(a.writeoff)),
      allocatedDate: a.allocatedDate,
      journalEntryId: a.journalEntryId,
    };
  }
}
