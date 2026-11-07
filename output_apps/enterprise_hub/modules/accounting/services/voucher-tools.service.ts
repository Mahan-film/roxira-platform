import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JournalEntryResponseDto } from '../dto/journal-entry-response.dto';
import { CopyJournalEntryDto } from '../dto/copy-journal-entry.dto';
import { JournalEntryEntity } from '../entities/journal-entry.entity';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { fromDb, minorToDecimal } from '../money';
import { AccountingRepository } from '../repositories/accounting.repository';
import { AccountingService } from './accounting.service';

/**
 * Voucher tools that sit next to the ledger but do not belong to the posting state machine.
 *
 * `copyVoucher` duplicates a voucher as a DRAFT: same lines (account, debit, credit, description,
 * currency, fx and dimensions) and the same description, a new number, and a caller-chosen date
 * (today by default). It goes through `AccountingService.createJournalEntry`, so the number is
 * issued by the normal route, a locked period or closed fiscal year is refused with the existing
 * 423, and the source row is never touched. A POSTED or reversing source is allowed; the copy is
 * always DRAFT and never posts.
 */
@Injectable()
export class VoucherToolsService {
  constructor(
    private readonly accountingRepository: AccountingRepository,
    private readonly accountingService: AccountingService,
  ) {}

  async copyVoucher(
    tenantId: string,
    id: number,
    dto: CopyJournalEntryDto,
  ): Promise<JournalEntryResponseDto> {
    // TenantScope + RLS: a source of another tenant is simply not found (404).
    const source = await this.accountingRepository.findEntryById(tenantId, id);
    if (!source) {
      throw new NotFoundException(`سند حسابداری با شناسه ${id} یافت نشد.`);
    }

    const lines = (source.lines ?? []).slice().sort((a, b) => a.id - b.id);
    const dimensionIds = lines.flatMap((line) =>
      [line.detailId, line.costCenterId, line.projectId].filter(
        (value): value is number => value != null,
      ),
    );
    const dimensionCodes = await this.accountingRepository.findDimensionCodesByIds(
      tenantId,
      dimensionIds,
    );
    const entryNumber = await this.copyNumber(tenantId, source);

    return this.accountingService.createJournalEntry(tenantId, {
      entryNumber,
      date: dto.date,
      description: source.description,
      status: JournalEntryStatus.DRAFT,
      lines: lines.map((line) => ({
        accountCode: line.account.code,
        debit: minorToDecimal(fromDb(line.debit)),
        credit: minorToDecimal(fromDb(line.credit)),
        description: line.description ?? undefined,
        currency: line.currency,
        amountFx: line.amountFx ?? undefined,
        fxRate: line.fxRate ?? undefined,
        partyCode: line.partyCode ?? undefined,
        detailCode:
          line.detailId != null ? dimensionCodes.get(line.detailId) : undefined,
        costCenterCode:
          line.costCenterId != null
            ? dimensionCodes.get(line.costCenterId)
            : undefined,
        projectCode:
          line.projectId != null ? dimensionCodes.get(line.projectId) : undefined,
      })),
    });
  }

  /** `<number>-COPY` when it fits and is free, else `COPY-<id>` (then a unique suffix). */
  private async copyNumber(
    tenantId: string,
    source: JournalEntryEntity,
  ): Promise<string> {
    const candidates = [
      `${source.entryNumber}-COPY`,
      `COPY-${source.id}`,
      `COPY-${source.id}-${Date.now().toString(36)}`,
    ];
    for (const candidate of candidates) {
      if (candidate.length > 64) {
        continue;
      }
      const taken = await this.accountingRepository.findEntryByNumber(
        tenantId,
        candidate,
      );
      if (!taken) {
        return candidate;
      }
    }
    throw new ConflictException(
      `شماره سند کپی برای ${source.entryNumber} قابل تولید نیست.`,
    );
  }
}
