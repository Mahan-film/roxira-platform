import { Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { FiscalMemoryProfileEntity } from '../entities/fiscal-memory-profile.entity';
import { TaxTransmissionEnvironment, TaxTransmissionMode } from '../enums/tax-transmission.enum';

export interface FiscalMemoryProfileInput {
  memoryId: string;
  mode: TaxTransmissionMode;
  environment: TaxTransmissionEnvironment;
  tspProvider?: string | null;
  active?: boolean;
}

export class FiscalMemoryProfileValidationError extends Error {}

/** Checks the shape of a profile; the DB has matching CHECK constraints. */
export function normalizeProfileInput(input: FiscalMemoryProfileInput): Required<FiscalMemoryProfileInput> {
  const memoryId = String(input.memoryId ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(memoryId)) {
    throw new FiscalMemoryProfileValidationError('memoryId must be exactly 6 letters/digits.');
  }
  if (!Object.values(TaxTransmissionMode).includes(input.mode)) {
    throw new FiscalMemoryProfileValidationError('Unknown transmission mode.');
  }
  if (!Object.values(TaxTransmissionEnvironment).includes(input.environment)) {
    throw new FiscalMemoryProfileValidationError('Unknown environment.');
  }
  const tspProvider = input.tspProvider?.trim() || null;
  const isTsp = input.mode !== TaxTransmissionMode.DIRECT;
  if (isTsp && !tspProvider) {
    throw new FiscalMemoryProfileValidationError('tspProvider is required for a TSP mode.');
  }
  if (!isTsp && tspProvider) {
    throw new FiscalMemoryProfileValidationError('tspProvider must be empty in direct mode.');
  }
  return { memoryId, mode: input.mode, environment: input.environment, tspProvider, active: input.active ?? true };
}

/** Only access path to `fiscal_memory_profiles`; every call runs inside TenantScope for its tenant. */
@Injectable()
export class FiscalMemoryProfileRepository {
  constructor(private readonly scope: TenantScope) {}

  create(tenantId: string, input: FiscalMemoryProfileInput): Promise<FiscalMemoryProfileEntity> {
    const data = normalizeProfileInput(input);
    return this.scope.run(tenantId, (m) => {
      const repo = m.getRepository(FiscalMemoryProfileEntity);
      return repo.save(repo.create({ ...data, tenantId }));
    });
  }

  list(tenantId: string): Promise<FiscalMemoryProfileEntity[]> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(FiscalMemoryProfileEntity).find({ where: { tenantId }, order: { createdAt: 'ASC' } }),
    );
  }

  findById(tenantId: string, id: string): Promise<FiscalMemoryProfileEntity | null> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(FiscalMemoryProfileEntity).findOne({ where: { tenantId, id } }),
    );
  }

  async setActive(tenantId: string, id: string, active: boolean): Promise<FiscalMemoryProfileEntity | null> {
    return this.scope.run(tenantId, async (m) => {
      const repo = m.getRepository(FiscalMemoryProfileEntity);
      await repo.update({ id, tenantId }, { active });
      return repo.findOne({ where: { tenantId, id } });
    });
  }
}
