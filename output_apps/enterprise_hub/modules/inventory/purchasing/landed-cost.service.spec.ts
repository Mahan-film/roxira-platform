import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PeriodLockedException } from '../../accounting/exceptions/ledger.exceptions';
import { AccountingService } from '../../accounting/services/accounting.service';
import { TenantScope } from '../../access/services/tenant-scope';
import { PostingRequest, PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { InventoryRepository, LockedFifoLayer } from '../repositories/inventory.repository';
import { StockDocumentsService } from '../services/stock-documents.service';
import { GoodsReceipt } from './purchase.types';
import { PurchaseRepository } from './purchase.repository';
import { LandedCostBasis, LandedCostCategory } from './landed-cost.domain';
import {
  LandedCost,
  LandedCostAllocation,
  LandedCostRepository,
  NewLandedCost,
  NewLandedCostAllocation,
} from './landed-cost.repository';
import { LandedCostService } from './landed-cost.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const FIXED = new Date('2026-11-05T08:00:00Z');

interface LayerState {
  tenantId: string;
  id: number;
  /** Hundredths of a unit still in the layer. */
  quantityRemaining: bigint;
}

interface FakeState {
  receipts: Map<string, GoodsReceipt>;
  layers: LayerState[];
  raises: Array<{ tenantId: string; batchId: number; deltaMinor: bigint }>;
  landedCosts: LandedCost[];
  journals: PostingRequest[];
  periodLocked: boolean;
  counters: Map<string, number>;
}

function freshState(): FakeState {
  return {
    receipts: new Map<string, GoodsReceipt>(),
    layers: [],
    raises: [],
    landedCosts: [],
    journals: [],
    periodLocked: false,
    counters: new Map<string, number>(),
  };
}

function nextId(state: FakeState, kind: string): string {
  const key = `id:${kind}`;
  const value = (state.counters.get(key) ?? 0) + 1;
  state.counters.set(key, value);
  return `${kind}-${value}`;
}

class FakeTenantScope {
  constructor(private readonly state: FakeState) {}

  async run<T>(_tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({
      layers: this.state.layers,
      raises: this.state.raises,
      landedCosts: this.state.landedCosts,
      journals: this.state.journals,
      counters: [...this.state.counters],
    });
    try {
      return await work({} as EntityManager);
    } catch (error) {
      this.state.layers = snapshot.layers;
      this.state.raises = snapshot.raises;
      this.state.landedCosts = snapshot.landedCosts;
      this.state.journals = snapshot.journals;
      this.state.counters = new Map(snapshot.counters);
      throw error;
    }
  }
}

class FakePurchaseRepository {
  constructor(private readonly state: FakeState) {}

  async findReceipt(tenantId: string, id: string): Promise<GoodsReceipt | null> {
    const found = this.state.receipts.get(`${tenantId}:${id}`);
    return found ? structuredClone(found) : null;
  }
}

class FakeLandedCostRepository {
  constructor(private readonly state: FakeState) {}

  async lockIdempotencyKey(): Promise<void> {
    // The advisory lock is a database concern; the fake runs requests one at a time.
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<LandedCost | null> {
    const found = this.state.landedCosts.find(
      (cost) => cost.tenantId === tenantId && cost.idempotencyKey === idempotencyKey,
    );
    return found ? structuredClone(found) : null;
  }

  async insertLandedCost(
    tenantId: string,
    input: NewLandedCost,
    allocations: readonly NewLandedCostAllocation[],
  ): Promise<LandedCost> {
    const id = nextId(this.state, 'lc');
    const cost: LandedCost = {
      id,
      tenantId,
      receiptId: input.receiptId,
      category: input.category,
      basis: input.basis,
      amount: input.amount,
      date: input.date,
      supplierCode: input.supplierCode,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      inventoryAmount: input.inventoryAmount,
      cogsAmount: input.cogsAmount,
      journalEntryId: null,
      createdAt: FIXED,
      allocations: allocations.map(
        (allocation): LandedCostAllocation => ({ ...allocation, id: nextId(this.state, 'alloc') }),
      ),
    };
    this.state.landedCosts.push(cost);
    return structuredClone(cost);
  }

  async markPosted(tenantId: string, id: string, journalEntryId: string): Promise<void> {
    const found = this.state.landedCosts.find((cost) => cost.tenantId === tenantId && cost.id === id);
    if (found) found.journalEntryId = journalEntryId;
  }
}

class FakeInventoryRepository {
  constructor(private readonly state: FakeState) {}

  /** Like the real repository: only the asked ids, of this tenant, as exact hundredths. */
  async lockFifoBatchesByIds(tenantId: string, ids: number[]): Promise<Map<number, LockedFifoLayer>> {
    const map = new Map<number, LockedFifoLayer>();
    for (const id of ids) {
      const layer = this.state.layers.find((entry) => entry.tenantId === tenantId && entry.id === id);
      if (layer) map.set(id, { id, quantityRemaining: layer.quantityRemaining });
    }
    return map;
  }

  async raiseLayerUnitCostByMinor(tenantId: string, batchId: number, deltaMinor: bigint): Promise<void> {
    this.state.raises.push({ tenantId, batchId, deltaMinor });
  }
}

class FakeStockDocuments {
  async resolveAccounts(): Promise<string[]> {
    return ['1030', '5110', '2010'];
  }
}

class FakePostingRules {
  constructor(private readonly state: FakeState) {}

  async describe(): Promise<never[]> {
    return [];
  }

  /** Like the engine: one voucher per (sourceType, sourceId, docType); a replay returns the first. */
  async post(
    _tenantId: string,
    request: PostingRequest,
  ): Promise<{ entryId: number; entryNumber: string; replayed: boolean }> {
    const index = this.state.journals.findIndex(
      (journal) =>
        journal.sourceType === request.sourceType &&
        journal.sourceId === request.sourceId &&
        journal.docType === request.docType,
    );
    if (index >= 0) {
      return { entryId: index + 1, entryNumber: this.state.journals[index].entryNumber ?? '', replayed: true };
    }
    this.state.journals.push(request);
    return { entryId: this.state.journals.length, entryNumber: request.entryNumber ?? '', replayed: false };
  }
}

class FakeAccounting {
  constructor(private readonly state: FakeState) {}

  async isPeriodLocked(): Promise<boolean> {
    return this.state.periodLocked;
  }
}

function makeService(state: FakeState): LandedCostService {
  return new LandedCostService(
    new FakeTenantScope(state) as unknown as TenantScope,
    new FakePurchaseRepository(state) as unknown as PurchaseRepository,
    new FakeLandedCostRepository(state) as unknown as LandedCostRepository,
    new FakeInventoryRepository(state) as unknown as InventoryRepository,
    new FakeStockDocuments() as unknown as StockDocumentsService,
    new FakePostingRules(state) as unknown as PostingRulesService,
    new FakeAccounting(state) as unknown as AccountingService,
  );
}

function seedReceipt(
  state: FakeState,
  tenantId: string,
  receiptId: string,
  lines: Array<Partial<GoodsReceipt['lines'][number]>>,
): GoodsReceipt {
  const receipt: GoodsReceipt = {
    id: receiptId,
    tenantId,
    number: 'GR-000001',
    orderId: 'order-1',
    supplierCode: 'SUP',
    receivedAt: FIXED,
    receivedBy: 'u1',
    idempotencyKey: null,
    totalValue: 0n,
    journalEntryId: null,
    lines: lines.map((line, index) => ({
      id: line.id ?? `line-${index + 1}`,
      orderLineId: line.orderLineId ?? `order-line-${index + 1}`,
      sku: line.sku ?? 'A',
      quantity: line.quantity ?? 1000n,
      unitCost: line.unitCost ?? 1_000_000n,
      value: line.value ?? 10_000_000n,
      weight: line.weight ?? null,
      fifoBatchId: line.fifoBatchId ?? index + 1,
    })),
  };
  state.receipts.set(`${tenantId}:${receiptId}`, receipt);
  return receipt;
}

function seedLayer(state: FakeState, tenantId: string, id: number, quantityRemaining: bigint): void {
  state.layers.push({ tenantId, id, quantityRemaining });
}

const BODY = {
  category: LandedCostCategory.FREIGHT,
  amount: '1000000',
  basis: LandedCostBasis.VALUE,
  date: '2026-11-05',
  supplierCode: 'SUP',
  reference: 'waybill-77',
  idempotencyKey: 'lc-key-1',
};

describe('LandedCostService (#227 T2)', () => {
  let state: FakeState;
  let service: LandedCostService;

  beforeEach(() => {
    state = freshState();
    service = makeService(state);
  });

  it('allocates freight by VALUE 600,000/400,000 and raises both untouched layers', async () => {
    seedReceipt(state, T1, 'receipt-1', [
      { id: 'l1', sku: 'A', quantity: 300n, value: 6_000_000n, fifoBatchId: 11 },
      { id: 'l2', sku: 'B', quantity: 100n, value: 4_000_000n, fifoBatchId: 12 },
    ]);
    seedLayer(state, T1, 11, 300n);
    seedLayer(state, T1, 12, 100n);

    const result = await service.createLandedCost(T1, 'u1', 'receipt-1', BODY);
    expect(result.amount).toBe('1000000');
    expect(result.inventoryAmount).toBe('1000000');
    expect(result.cogsAmount).toBe('0');
    expect(result.allocations.map((allocation) => allocation.share)).toEqual(['600000', '400000']);
    expect(result.allocations.map((allocation) => allocation.toInventory)).toEqual(['600000', '400000']);
    expect(result.allocations.map((allocation) => allocation.fifoBatchId)).toEqual([11, 12]);
    expect(state.raises).toEqual([
      { tenantId: T1, batchId: 11, deltaMinor: 200_000n },
      { tenantId: T1, batchId: 12, deltaMinor: 400_000n },
    ]);
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0]).toMatchObject({
      docType: 'purchase.landed_cost',
      sourceType: 'landed_cost',
      sourceId: result.id,
      entryNumber: `LC-${result.id}`,
      partyCode: 'SUP',
      amounts: { inventory: 1_000_000n, cogs: 0n, payable: 1_000_000n },
    });
    expect(state.journals[0].overrides).toMatchObject({ inventory: '1030', cogs: '5110', payable: '2010' });
  });

  it('allocates by QUANTITY with 3.00 and 1.00 as 750,000/250,000', async () => {
    seedReceipt(state, T1, 'receipt-1', [
      { id: 'l1', quantity: 300n, value: 6_000_000n, fifoBatchId: 11 },
      { id: 'l2', quantity: 100n, value: 4_000_000n, fifoBatchId: 12 },
    ]);
    seedLayer(state, T1, 11, 300n);
    seedLayer(state, T1, 12, 100n);

    const result = await service.createLandedCost(T1, 'u1', 'receipt-1', {
      ...BODY,
      basis: LandedCostBasis.QUANTITY,
    });
    expect(result.allocations.map((allocation) => allocation.share)).toEqual(['750000', '250000']);
    expect(result.allocations.map((allocation) => allocation.basisValue)).toEqual(['300', '100']);
    expect(state.raises).toEqual([
      { tenantId: T1, batchId: 11, deltaMinor: 250_000n },
      { tenantId: T1, batchId: 12, deltaMinor: 250_000n },
    ]);
  });

  it('gives the remainder of 100 over three equal lines as 34/33/33 in line order', async () => {
    seedReceipt(state, T1, 'receipt-1', [
      { id: 'l1', value: 1_000_000n, fifoBatchId: 11 },
      { id: 'l2', value: 1_000_000n, fifoBatchId: 12 },
      { id: 'l3', value: 1_000_000n, fifoBatchId: 13 },
    ]);
    for (const id of [11, 12, 13]) seedLayer(state, T1, id, 1000n);

    const result = await service.createLandedCost(T1, 'u1', 'receipt-1', { ...BODY, amount: '100' });
    expect(result.allocations.map((allocation) => allocation.share)).toEqual(['34', '33', '33']);
    // Each 10-unit layer raises 3 minor units per unit (30 minor units per line = 90 inventory); remainder 10 goes to COGS.
    expect(state.journals[0].amounts).toMatchObject({ inventory: 90n, cogs: 10n, payable: 100n });
  });

  it('splits a late freight on a 40%-sold line into 400,000 COGS and 600,000 into the layer', async () => {
    seedReceipt(state, T1, 'receipt-1', [{ id: 'l1', quantity: 1000n, value: 10_000_000n, fifoBatchId: 21 }]);
    seedLayer(state, T1, 21, 600n);

    const result = await service.createLandedCost(T1, 'u1', 'receipt-1', BODY);
    expect(result.inventoryAmount).toBe('600000');
    expect(result.cogsAmount).toBe('400000');
    expect(result.allocations[0]).toMatchObject({
      receiptLineId: 'l1',
      share: '1000000',
      toInventory: '600000',
      toCogs: '400000',
    });
    expect(state.raises).toEqual([{ tenantId: T1, batchId: 21, deltaMinor: 100_000n }]);
    const journal = state.journals[0];
    // The voucher is balanced by construction: inventory + cogs == payable.
    expect(journal.amounts.inventory + journal.amounts.cogs).toBe(journal.amounts.payable);
    expect(journal.amounts).toMatchObject({ inventory: 600_000n, cogs: 400_000n, payable: 1_000_000n });
  });

  it('returns the same record for a repeated idempotency key and posts nothing twice', async () => {
    seedReceipt(state, T1, 'receipt-1', [{ id: 'l1', quantity: 1000n, value: 10_000_000n, fifoBatchId: 21 }]);
    seedLayer(state, T1, 21, 1000n);

    const first = await service.createLandedCost(T1, 'u1', 'receipt-1', BODY);
    const again = await service.createLandedCost(T1, 'u1', 'receipt-1', BODY);
    expect(again.id).toBe(first.id);
    expect(state.landedCosts).toHaveLength(1);
    expect(state.journals).toHaveLength(1);
    expect(state.raises).toEqual([{ tenantId: T1, batchId: 21, deltaMinor: 100_000n }]);
  });

  it('refuses a repeated key that names another receipt (409); the on-hand share stays whole in the voucher', async () => {
    seedReceipt(state, T1, 'receipt-1', [{ id: 'l1', quantity: 300n, value: 1_000_000n, fifoBatchId: 31 }]);
    seedReceipt(state, T1, 'receipt-2', [{ id: 'l2', quantity: 300n, value: 1_000_000n, fifoBatchId: 32 }]);
    seedLayer(state, T1, 31, 300n);
    seedLayer(state, T1, 32, 300n);

    const first = await service.createLandedCost(T1, 'u1', 'receipt-1', { ...BODY, amount: '100' });
    // 100 minor units over 3 units: the layer raises 33 per unit (99 in all); remainder 1 is booked to COGS.
    expect(first.allocations[0]).toMatchObject({ toInventory: '99', toCogs: '1' });
    expect(first.inventoryAmount).toBe('99');
    expect(first.cogsAmount).toBe('1');
    expect(state.raises).toEqual([{ tenantId: T1, batchId: 31, deltaMinor: 33n }]);
    expect(state.journals[0].amounts).toMatchObject({ inventory: 99n, cogs: 1n, payable: 100n });

    await expect(service.createLandedCost(T1, 'u1', 'receipt-2', { ...BODY, amount: '100' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(state.landedCosts).toHaveLength(1);
  });

  it('hides a receipt from another tenant (404) and refuses a weightless WEIGHT allocation (400)', async () => {
    seedReceipt(state, T1, 'receipt-1', [{ id: 'l1', quantity: 1000n, fifoBatchId: 21 }]);
    seedLayer(state, T1, 21, 1000n);

    await expect(service.createLandedCost(T2, 'u1', 'receipt-1', BODY)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(state.landedCosts).toHaveLength(0);

    await expect(
      service.createLandedCost(T1, 'u1', 'receipt-1', { ...BODY, basis: LandedCostBasis.WEIGHT }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.landedCosts).toHaveLength(0);
    expect(state.journals).toHaveLength(0);
    expect(state.raises).toHaveLength(0);
  });

  it('refuses a receipt line whose FIFO layer is unknown instead of guessing', async () => {
    seedReceipt(state, T1, 'receipt-1', [{ id: 'l1', quantity: 1000n, fifoBatchId: null }]);
    await expect(service.createLandedCost(T1, 'u1', 'receipt-1', BODY)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(state.landedCosts).toHaveLength(0);
  });

  it('refuses a locked period before writing anything', async () => {
    seedReceipt(state, T1, 'receipt-1', [{ id: 'l1', quantity: 1000n, fifoBatchId: 21 }]);
    seedLayer(state, T1, 21, 1000n);
    state.periodLocked = true;

    await expect(service.createLandedCost(T1, 'u1', 'receipt-1', BODY)).rejects.toBeInstanceOf(
      PeriodLockedException,
    );
    expect(state.landedCosts).toHaveLength(0);
    expect(state.journals).toHaveLength(0);
    expect(state.raises).toHaveLength(0);
  });
});
