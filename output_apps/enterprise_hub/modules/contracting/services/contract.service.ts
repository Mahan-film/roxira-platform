import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fromDb, fromMinor, parseMinor } from '../../accounting/money';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { PartiesService } from '../../parties/services/parties.service';
import { ContractListResponseDto, ContractResponseDto, CreateContractDto, QueryContractsDto, UpdateContractDto } from '../dto/contract.dto';
import { ContractEntity } from '../entities/contract.entity';
import { ContractSide, ContractStatus } from '../enums/contracting.enum';
import { ContractPatch, ContractRepository } from '../repositories/contract.repository';
import { ProjectRepository } from '../repositories/project.repository';
import { isDuplicateKey, moneyToColumn } from './project.service';

const NOT_FOUND = 'قرارداد یافت نشد.';
const TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  [ContractStatus.DRAFT]: [ContractStatus.ACTIVE, ContractStatus.CLOSED],
  [ContractStatus.ACTIVE]: [ContractStatus.CLOSED],
  [ContractStatus.CLOSED]: [],
};

/** draft -> active -> closed (draft -> closed too); nothing leaves closed, nothing goes back. */
export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Employer side owes a supplier-type party, contractor side bills a customer-type party. */
export function partyFitsSide(side: ContractSide, role: PartyRole): boolean {
  if (role === PartyRole.BOTH) return true;
  return side === ContractSide.EMPLOYER ? role === PartyRole.SUPPLIER : role === PartyRole.CUSTOMER;
}

export function toContractResponse(c: ContractEntity): ContractResponseDto {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    side: c.side,
    partyCode: c.partyCode,
    projectId: c.projectId ?? null,
    contractDate: typeof c.contractDate === 'string' ? c.contractDate : String(c.contractDate),
    amount: fromMinor(fromDb(c.amount)),
    advanceAmount: fromMinor(fromDb(c.advanceAmount)),
    insuranceType: c.insuranceType ?? null,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

@Injectable()
export class ContractService {
  constructor(
    private readonly repository: ContractRepository,
    private readonly projects: ProjectRepository,
    private readonly parties: PartiesService,
  ) {}

  async list(tenantId: string, query: QueryContractsDto): Promise<ContractListResponseDto> {
    const { rows, total } = await this.repository.list(tenantId, query);
    return { data: rows.map(toContractResponse), total };
  }

  async getById(tenantId: string, id: number): Promise<ContractResponseDto> {
    const contract = await this.repository.findById(tenantId, id);
    if (!contract) throw new NotFoundException(NOT_FOUND);
    return toContractResponse(contract);
  }

  private async assertProject(tenantId: string, projectId: number | null | undefined): Promise<void> {
    if (projectId == null) return;
    if (!(await this.projects.findById(tenantId, projectId))) throw new BadRequestException('پروژه یافت نشد.');
  }

  private assertAdvance(amount: string, advance: string): void {
    if (parseMinor(advance) > parseMinor(amount)) throw new BadRequestException('پیش‌پرداخت از مبلغ قرارداد بیشتر است.');
  }

  async create(tenantId: string, dto: CreateContractDto): Promise<ContractResponseDto> {
    const code = dto.code.trim();
    const amount = moneyToColumn(dto.amount);
    const advanceAmount = moneyToColumn(dto.advanceAmount ?? '0');
    if (parseMinor(amount) <= 0n) throw new BadRequestException('مبلغ قرارداد باید بزرگ‌تر از صفر باشد.');
    this.assertAdvance(amount, advanceAmount);
    let party;
    try {
      party = await this.parties.getByCode(tenantId, dto.partyCode);
    } catch (error) {
      if (error instanceof NotFoundException) throw new BadRequestException('طرف حساب یافت نشد.');
      throw error;
    }
    if (!partyFitsSide(dto.side, party.role)) throw new BadRequestException('نقش طرف حساب با سمت قرارداد سازگار نیست.');
    await this.assertProject(tenantId, dto.projectId);
    if (await this.repository.findByCode(tenantId, code)) throw new ConflictException('کد قرارداد تکراری است.');
    try {
      const created = await this.repository.create(tenantId, {
        code,
        title: dto.title.trim(),
        side: dto.side,
        partyCode: party.code,
        projectId: dto.projectId ?? null,
        contractDate: dto.contractDate,
        amount,
        advanceAmount,
        insuranceType: dto.insuranceType ?? null,
      });
      return toContractResponse(created);
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException('کد قرارداد تکراری است.');
      throw error;
    }
  }

  async update(tenantId: string, id: number, dto: UpdateContractDto): Promise<ContractResponseDto> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException(NOT_FOUND);
    const terms = dto.projectId !== undefined || dto.amount !== undefined || dto.advanceAmount !== undefined || dto.insuranceType !== undefined;
    if (terms && existing.status !== ContractStatus.DRAFT) {
      throw new ConflictException('قرارداد فعال یا بسته‌شده را نمی‌توان در مبلغ و شرایط تغییر داد.');
    }
    if (dto.status !== undefined && dto.status !== existing.status && !canTransition(existing.status, dto.status)) {
      throw new ConflictException('تغییر وضعیت قرارداد مجاز نیست.');
    }
    const patch: ContractPatch = {};
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.contractDate !== undefined) patch.contractDate = dto.contractDate;
    if (dto.amount !== undefined) patch.amount = moneyToColumn(dto.amount);
    if (dto.advanceAmount !== undefined) patch.advanceAmount = moneyToColumn(dto.advanceAmount);
    if (dto.insuranceType !== undefined) patch.insuranceType = dto.insuranceType;
    if (dto.projectId !== undefined) {
      await this.assertProject(tenantId, dto.projectId);
      patch.projectId = dto.projectId;
    }
    if (dto.status !== undefined) patch.status = dto.status;
    const amount = patch.amount ?? existing.amount;
    if (parseMinor(amount) <= 0n) throw new BadRequestException('مبلغ قرارداد باید بزرگ‌تر از صفر باشد.');
    this.assertAdvance(amount, patch.advanceAmount ?? existing.advanceAmount);
    const updated = await this.repository.update(tenantId, id, patch);
    if (!updated) throw new NotFoundException(NOT_FOUND);
    return toContractResponse(updated);
  }
}
