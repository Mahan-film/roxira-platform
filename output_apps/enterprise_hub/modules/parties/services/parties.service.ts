import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditService } from '../../access/services/audit.service';
import { fromMinor, toMinor } from '../../accounting/money';
import { CustomerGroup } from '../enums/customer-group.enum';
import { PartyEntity } from '../entities/party.entity';
import { PartyRole } from '../enums/party-role.enum';
import {
  CreatePartyDto,
  PartyResponseDto,
  QueryPartiesDto,
  UpdatePartyDto,
} from '../dto/party.dto';
import { PartyInput, PartiesRepository, PartyPatch, UpsertedPartyRow } from '../repositories/parties.repository';
import { ERASED_PARTY_NAME } from './party-crypto';

const DUPLICATE_CODE_MESSAGE = 'کد طرف حساب تکراری است.';
const NOT_FOUND_MESSAGE = 'طرف حساب یافت نشد.';

/** Entity -> API shape; pure so the importer and tests can reuse it. */
export function toPartyResponse(party: PartyEntity): PartyResponseDto {
  const erased = Boolean(party.erasedAt);
  return {
    id: party.id,
    code: party.code,
    name: erased ? ERASED_PARTY_NAME : party.name,
    role: party.role,
    nationalId: erased ? null : (party.nationalId ?? null),
    economicCode: erased ? null : (party.economicCode ?? null),
    phone: erased ? null : (party.phone ?? null),
    email: erased ? null : (party.email ?? null),
    active: erased ? false : party.active,
    creditLimit: party.creditLimit ? String(fromMinor(BigInt(party.creditLimit))) : '0',
    customerGroup: party.customerGroup ?? CustomerGroup.CONSUMER,
    createdAt: party.createdAt,
    updatedAt: party.updatedAt,
  };
}

function isDuplicateCode(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

/**
 * Party master: create, look up, edit and list customers/suppliers. The importer reuses the
 * repository through `findExistingCodes` / `upsertMany` / `removeByIds`.
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly repository: PartiesRepository,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async list(tenantId: string, query: QueryPartiesDto): Promise<{ data: PartyResponseDto[]; total: number }> {
    const { rows, total } = await this.repository.list(tenantId, query);
    return { data: rows.map(toPartyResponse), total };
  }

  async getByCode(tenantId: string, code: string): Promise<PartyResponseDto> {
    const party = await this.repository.findByCode(tenantId, code);
    if (!party) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return toPartyResponse(party);
  }

  async create(tenantId: string, dto: CreatePartyDto): Promise<PartyResponseDto> {
    const code = dto.code.trim();
    let creditLimit = '0';
    if (dto.creditLimit) {
      try {
        creditLimit = toMinor(dto.creditLimit).toString();
      } catch (error) {
        throw new BadRequestException('سقف اعتبار نامعتبر است.');
      }
    }
    const input: PartyInput = {
      code,
      name: dto.name.trim(),
      role: dto.role,
      nationalId: dto.nationalId ?? null,
      economicCode: dto.economicCode ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      creditLimit,
      active: dto.active ?? true,
      customerGroup: dto.customerGroup ?? CustomerGroup.CONSUMER,
    };
    if (await this.repository.findByCode(tenantId, code)) throw new ConflictException(DUPLICATE_CODE_MESSAGE);
    try {
      return toPartyResponse(await this.repository.create(tenantId, input));
    } catch (error) {
      if (isDuplicateCode(error)) throw new ConflictException(DUPLICATE_CODE_MESSAGE);
      throw error;
    }
  }

  async update(tenantId: string, id: number, dto: UpdatePartyDto): Promise<PartyResponseDto> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException(NOT_FOUND_MESSAGE);
    const patch: PartyPatch = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.nationalId !== undefined) patch.nationalId = dto.nationalId;
    if (dto.economicCode !== undefined) patch.economicCode = dto.economicCode;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.creditLimit !== undefined) {
      try {
        patch.creditLimit = toMinor(dto.creditLimit).toString();
      } catch (error) {
        throw new BadRequestException('سقف اعتبار نامعتبر است.');
      }
    }
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.customerGroup !== undefined) patch.customerGroup = dto.customerGroup;
    const updated = await this.repository.update(tenantId, id, patch);
    if (!updated) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return toPartyResponse(updated);
  }

  // ------------------------------------------------------------------ importer helpers

  findExistingCodes(tenantId: string, codes: string[]): Promise<string[]> {
    return this.repository.findExistingCodes(tenantId, codes);
  }

  upsertMany(tenantId: string, inputs: PartyInput[]): Promise<UpsertedPartyRow[]> {
    return this.repository.insertMany(tenantId, inputs);
  }

  removeByIds(tenantId: string, ids: number[]): Promise<number> {
    return this.repository.deleteByIds(tenantId, ids);
  }

  /**
   * Erase a party's personal data by crypto-shredding (destroying the per-party key in
   * `erp_party_keys` and scrubbing plaintext PII). The audit event records `partyId` only.
   */
  async erasePersonalData(tenantId: string, partyId: number): Promise<{ partyId: number; erased: true }> {
    const erased = await this.repository.erasePersonalData(tenantId, partyId);
    if (!erased) throw new NotFoundException(NOT_FOUND_MESSAGE);
    await this.audit?.record({
      tenantId,
      actorUserId: null,
      action: 'party.erased',
      resourceType: 'party',
      resourceId: String(partyId),
      metadata: { partyId },
    });
    return { partyId, erased: true };
  }
}
