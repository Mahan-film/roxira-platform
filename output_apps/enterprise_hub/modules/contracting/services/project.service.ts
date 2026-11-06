import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fromDb, fromMinor, minorToDecimal, MoneyFormatError, parseMinor } from '../../accounting/money';
import { CreateProjectDto, ProjectResponseDto, QueryProjectsDto, UpdateProjectDto } from '../dto/project.dto';
import { ProjectEntity } from '../entities/project.entity';
import { ProjectPatch, ProjectRepository } from '../repositories/project.repository';

const NOT_FOUND = 'پروژه یافت نشد.';

/** Decimal string -> exact numeric text for the column; refuses malformed money. */
export function moneyToColumn(value: string): string {
  try {
    return minorToDecimal(parseMinor(value));
  } catch (error) {
    if (error instanceof MoneyFormatError) throw new BadRequestException('مبلغ معتبر نیست.');
    throw error;
  }
}

export function isDuplicateKey(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

export function toProjectResponse(p: ProjectEntity): ProjectResponseDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    costCentreCode: p.costCentreCode ?? null,
    budget: fromMinor(fromDb(p.budget)),
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function assertDates(start: string | null | undefined, end: string | null | undefined): void {
  if (start && end && end < start) throw new BadRequestException('تاریخ پایان پروژه پیش از تاریخ شروع است.');
}

@Injectable()
export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  async list(tenantId: string, query: QueryProjectsDto): Promise<{ data: ProjectResponseDto[]; total: number }> {
    const { rows, total } = await this.repository.list(tenantId, query);
    return { data: rows.map(toProjectResponse), total };
  }

  async getById(tenantId: string, id: number): Promise<ProjectResponseDto> {
    const project = await this.repository.findById(tenantId, id);
    if (!project) throw new NotFoundException(NOT_FOUND);
    return toProjectResponse(project);
  }

  async create(tenantId: string, dto: CreateProjectDto): Promise<ProjectResponseDto> {
    const code = dto.code.trim();
    assertDates(dto.startDate, dto.endDate);
    const input = {
      code,
      name: dto.name.trim(),
      costCentreCode: dto.costCentreCode ?? null,
      budget: moneyToColumn(dto.budget ?? '0'),
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
    };
    if (await this.repository.findByCode(tenantId, code)) throw new ConflictException('کد پروژه تکراری است.');
    try {
      return toProjectResponse(await this.repository.create(tenantId, input));
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException('کد پروژه تکراری است.');
      throw error;
    }
  }

  async update(tenantId: string, id: number, dto: UpdateProjectDto): Promise<ProjectResponseDto> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException(NOT_FOUND);
    assertDates(dto.startDate ?? existing.startDate, dto.endDate ?? existing.endDate);
    const patch: ProjectPatch = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.costCentreCode !== undefined) patch.costCentreCode = dto.costCentreCode;
    if (dto.budget !== undefined) patch.budget = moneyToColumn(dto.budget);
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.endDate !== undefined) patch.endDate = dto.endDate;
    if (dto.status !== undefined) patch.status = dto.status;
    const updated = await this.repository.update(tenantId, id, patch);
    if (!updated) throw new NotFoundException(NOT_FOUND);
    return toProjectResponse(updated);
  }
}
