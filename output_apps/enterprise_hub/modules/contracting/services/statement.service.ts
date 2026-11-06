import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fromDb, fromMinor, minorToDecimal } from '../../accounting/money';
import { PostingRuleError } from '../../posting_rules/domain/posting-error';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { CreateStatementDto, StatementResponseDto } from '../dto/statement.dto';
import { ProgressStatementEntity } from '../entities/progress-statement.entity';
import { ContractSide, ContractStatus, StatementStatus } from '../enums/contracting.enum';
import { ContractRepository } from '../repositories/contract.repository';
import { StatementRepository } from '../repositories/statement.repository';
import { netPayable, nextPeriod, StatementError } from '../statements/statement-math';
import { moneyToColumn } from './project.service';

const NOT_FOUND = 'صورت وضعیت یافت نشد.';
const CONTRACT_NOT_FOUND = 'قرارداد یافت نشد.';
export const STATEMENT_SOURCE = 'progress_statement';
export const STATEMENT_DOC_TYPE: Record<ContractSide, string> = {
  [ContractSide.CONTRACTOR]: 'contract.statement.contractor',
  [ContractSide.EMPLOYER]: 'contract.statement.employer',
};

const minor = (value: string): bigint => fromDb(value);

export function toStatementResponse(s: ProgressStatementEntity, replayed?: boolean): StatementResponseDto {
  const net = netPayable(minor(s.periodAmount), minor(s.retentionAmount), minor(s.insuranceAmount), minor(s.advanceRecoveryAmount));
  return {
    id: s.id,
    contractId: s.contractId,
    number: s.number,
    statementDate: typeof s.statementDate === 'string' ? s.statementDate : String(s.statementDate),
    cumulativeAmount: fromMinor(minor(s.cumulativeAmount)),
    previousAmount: fromMinor(minor(s.previousAmount)),
    periodAmount: fromMinor(minor(s.periodAmount)),
    retentionAmount: fromMinor(minor(s.retentionAmount)),
    insuranceAmount: fromMinor(minor(s.insuranceAmount)),
    advanceRecoveryAmount: fromMinor(minor(s.advanceRecoveryAmount)),
    netPayable: fromMinor(net),
    status: s.status,
    journalEntryId: s.journalEntryId ?? null,
    journalEntryNumber: s.journalEntryNumber ?? null,
    approvedAt: s.approvedAt ?? null,
    postedAt: s.postedAt ?? null,
    ...(replayed === undefined ? {} : { replayed }),
  };
}

@Injectable()
export class StatementService {
  constructor(
    private readonly repository: StatementRepository,
    private readonly contracts: ContractRepository,
    private readonly postingRules: PostingRulesService,
  ) {}

  async list(tenantId: string, contractId: number): Promise<StatementResponseDto[]> {
    if (!(await this.contracts.findById(tenantId, contractId))) throw new NotFoundException(CONTRACT_NOT_FOUND);
    return (await this.repository.listByContract(tenantId, contractId)).map((s) => toStatementResponse(s));
  }

  async getById(tenantId: string, id: number): Promise<StatementResponseDto> {
    const s = await this.repository.findById(tenantId, id);
    if (!s) throw new NotFoundException(NOT_FOUND);
    return toStatementResponse(s);
  }

  /** Next statement of an active contract: numbered 1, 2, 3...; cumulative must grow; the previous one must be approved. */
  create(tenantId: string, contractId: number, dto: CreateStatementDto): Promise<StatementResponseDto> {
    return this.repository.runInTransaction(tenantId, async (manager) => {
      await this.repository.lockContract(tenantId, contractId, manager);
      const contract = await this.contracts.findById(tenantId, contractId, manager);
      if (!contract) throw new NotFoundException(CONTRACT_NOT_FOUND);
      if (contract.status !== ContractStatus.ACTIVE) throw new ConflictException('فقط قرارداد فعال صورت وضعیت می‌پذیرد.');
      const last = await this.repository.findLast(tenantId, contractId, manager);
      if (last?.status === StatementStatus.DRAFT) throw new ConflictException('صورت وضعیت قبلی هنوز تأیید نشده است.');
      if (last && dto.statementDate < String(last.statementDate)) {
        throw new BadRequestException('تاریخ صورت وضعیت از صورت وضعیت قبلی عقب‌تر است.');
      }
      const cumulative = moneyToColumn(dto.cumulativeAmount);
      const previous = last ? last.cumulativeAmount : '0.00';
      let period: bigint;
      try {
        period = nextPeriod(minor(previous), minor(cumulative), minor(contract.amount));
      } catch (error) {
        if (error instanceof StatementError) {
          throw new BadRequestException(error.code === 'OVER_CONTRACT' ? 'مبلغ تجمعی از مبلغ قرارداد بیشتر است.' : 'مبلغ تجمعی باید از صورت وضعیت قبلی بیشتر باشد.');
        }
        throw error;
      }
      const created = await this.repository.insert(
        tenantId,
        {
          contractId,
          number: (last?.number ?? 0) + 1,
          statementDate: dto.statementDate,
          cumulativeAmount: cumulative,
          previousAmount: moneyToColumn(previous),
          periodAmount: minorToDecimal(period),
        },
        manager,
      );
      return toStatementResponse(created);
    });
  }

  async approve(tenantId: string, id: number): Promise<StatementResponseDto> {
    const approved = await this.repository.setApproved(tenantId, id);
    if (approved) return toStatementResponse(approved);
    if (!(await this.repository.findById(tenantId, id))) throw new NotFoundException(NOT_FOUND);
    throw new ConflictException('فقط صورت وضعیت پیش‌نویس قابل تأیید است.');
  }

  async remove(tenantId: string, id: number): Promise<void> {
    if (await this.repository.deleteDraft(tenantId, id)) return;
    if (!(await this.repository.findById(tenantId, id))) throw new NotFoundException(NOT_FOUND);
    throw new ConflictException('فقط صورت وضعیت پیش‌نویس حذف می‌شود.');
  }

  /** Posts an approved statement once: the voucher and the status change commit together; a second call replays. */
  post(tenantId: string, id: number): Promise<StatementResponseDto> {
    return this.repository.runInTransaction(tenantId, async (manager) => {
      const s = await this.repository.findById(tenantId, id, manager);
      if (!s) throw new NotFoundException(NOT_FOUND);
      if (s.status === StatementStatus.POSTED) return toStatementResponse(s, true);
      if (s.status !== StatementStatus.APPROVED) throw new ConflictException('صورت وضعیت باید ابتدا تأیید شود.');
      const contract = await this.contracts.findById(tenantId, s.contractId, manager);
      if (!contract) throw new NotFoundException(CONTRACT_NOT_FOUND);
      const retention = minor(s.retentionAmount);
      const insurance = minor(s.insuranceAmount);
      const advance = minor(s.advanceRecoveryAmount);
      const gross = minor(s.periodAmount);
      try {
        const result = await this.postingRules.post(
          tenantId,
          {
            docType: STATEMENT_DOC_TYPE[contract.side],
            sourceType: STATEMENT_SOURCE,
            sourceId: String(s.id),
            date: String(s.statementDate),
            description: `صورت وضعیت شماره ${s.number} قرارداد ${contract.code}`,
            partyCode: contract.partyCode,
            amounts: { gross, retention, insurance, advance, net: netPayable(gross, retention, insurance, advance) },
          },
          manager,
        );
        const posted = await this.repository.markPosted(tenantId, s.id, { journalEntryId: result.entryId, journalEntryNumber: result.entryNumber }, manager);
        if (!posted) throw new ConflictException('وضعیت صورت وضعیت هم‌زمان تغییر کرد.');
        return toStatementResponse(posted, result.replayed);
      } catch (error) {
        if (error instanceof PostingRuleError) throw new ConflictException(error.message);
        throw error;
      }
    });
  }
}
