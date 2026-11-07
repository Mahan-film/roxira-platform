import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../../access/services/audit.service';
import { TenantScope } from '../../access/services/tenant-scope';
import { PolicyService } from './policy.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const owner = { userId: 'u1', roleKey: 'owner' };

interface PolicyRow {
  value: unknown;
  updatedBy: string;
  updatedAt: Date;
}

interface PurchaseRow {
  o: number;
  b: number;
  a: string;
  updatedAt: Date;
}

/** In-memory stand-in for the two tables the service reads and writes with raw SQL. */
class FakeDb {
  policy = new Map<string, PolicyRow>();
  purchase = new Map<string, PurchaseRow>();
  writes = 0;
}

function fakeManager(db: FakeDb): EntityManager {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (s.startsWith('insert into "tenant_policy_settings"')) {
      const [tenantId, key, value, updatedBy] = params as string[];
      db.policy.set(`${tenantId}:${key}`, { value: JSON.parse(value), updatedBy, updatedAt: new Date() });
      db.writes += 1;
      return [];
    }
    if (s.startsWith('insert into "erp_purchase_settings"')) {
      const [tenantId, o, b, a] = params as [string, number, number, string];
      db.purchase.set(tenantId, { o: Number(o), b: Number(b), a: String(a), updatedAt: new Date() });
      db.writes += 1;
      return [];
    }
    if (s.startsWith('select "key", "value", "updated_by", "updated_at" from "tenant_policy_settings"')) {
      const [tenantId] = params as string[];
      return [...db.policy.entries()]
        .filter(([k]) => k.startsWith(`${tenantId}:`))
        .map(([k, row]) => ({
          key: k.slice(tenantId.length + 1),
          value: row.value,
          updated_by: row.updatedBy,
          updated_at: row.updatedAt,
        }));
    }
    if (s.startsWith('select "value" as v from "tenant_policy_settings"')) {
      const [tenantId, key] = params as string[];
      const row = db.policy.get(`${tenantId}:${key}`);
      return row ? [{ v: row.value }] : [];
    }
    if (s.startsWith('select "over_receipt_tolerance_bp" as o')) {
      const row = db.purchase.get((params as string[])[0]);
      return row ? [{ o: row.o, b: row.b, a: row.a }] : [];
    }
    if (s.startsWith('select "price_tolerance_bp", "price_tolerance_abs", "updated_at" from "erp_purchase_settings"')) {
      const row = db.purchase.get((params as string[])[0]);
      return row ? [{ price_tolerance_bp: row.b, price_tolerance_abs: row.a, updated_at: row.updatedAt }] : [];
    }
    if (s.startsWith('select "price_tolerance_bp" as v') || s.startsWith('select "price_tolerance_abs" as v')) {
      const row = db.purchase.get((params as string[])[0]);
      if (!row) return [];
      return [{ v: s.includes('"price_tolerance_abs"') ? row.a : row.b }];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { query } as unknown as EntityManager;
}

function makeService(db: FakeDb) {
  const audit = { record: jest.fn<Promise<void>, [Record<string, unknown>]>(async () => undefined) };
  const scope = {
    run: <T>(_tenantId: string, work: (m: EntityManager) => Promise<T>) => work(fakeManager(db)),
    within: <T>(_tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>) =>
      work(manager ?? fakeManager(db)),
  };
  const service = new PolicyService(scope as unknown as TenantScope, audit as unknown as AuditService);
  return { service, audit };
}

describe('PolicyService (#585)', () => {
  it('owner sets a group C key: value written and exactly one policy.changed audit', async () => {
    const db = new FakeDb();
    const { service, audit } = makeService(db);

    const view = await service.set(T1, owner, 'purchase.three_way.qty_excess_tolerance_bp', 100, 'کاهش موقت');

    expect(view.value).toBe(100);
    expect(view.isDefault).toBe(false);
    expect(db.policy.get(`${T1}:purchase.three_way.qty_excess_tolerance_bp`)?.value).toBe(100);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0] as { action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> };
    expect(entry).toMatchObject({
      action: 'policy.changed',
      resourceType: 'tenant_policy',
      resourceId: 'purchase.three_way.qty_excess_tolerance_bp',
    });
    expect(entry.metadata).toMatchObject({ group: 'C', oldValue: 0, newValue: 100, reason: 'کاهش موقت' });
  });

  it('a group B change needs 15 characters and audits as policy.changed.protected', async () => {
    const db = new FakeDb();
    const { service, audit } = makeService(db);
    const key = 'purchase.invoice_review.reviewer_rule';

    await expect(
      service.set(T1, owner, key, 'creator_may_accept', 'x'.repeat(14)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.record).not.toHaveBeenCalled();

    const view = await service.set(T1, owner, key, 'creator_may_accept', 'x'.repeat(15));
    expect(view.value).toBe('creator_may_accept');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0][0] as { action: string }).action).toBe('policy.changed.protected');
  });

  it('refuses an accountant and refuses every group A key even for the owner', async () => {
    const { service } = makeService(new FakeDb());

    await expect(
      service.set(T1, { userId: 'u2', roleKey: 'accountant' }, 'purchase.three_way.qty_excess_tolerance_bp', 10, 'x'.repeat(5)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.set(T1, owner, 'ledger.posted_voucher_immutable', true, 'x'.repeat(5)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a same-value set writes nothing and audits nothing', async () => {
    const db = new FakeDb();
    const { service, audit } = makeService(db);

    await service.set(T1, owner, 'purchase.three_way.qty_excess_tolerance_bp', 0, 'x'.repeat(5));

    expect(db.writes).toBe(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('writes a price tolerance into erp_purchase_settings and keeps the other price column', async () => {
    const db = new FakeDb();
    const { service } = makeService(db);

    await service.set(T1, owner, 'purchase.three_way.price_tolerance_abs', 1000, 'x'.repeat(5));
    await service.set(T1, owner, 'purchase.three_way.price_tolerance_bp', 500, 'x'.repeat(5));

    expect(db.purchase.get(T1)).toMatchObject({ b: 500, a: '1000' });
    expect(db.policy.size).toBe(0); // store keys never touch the policy table
    expect(await service.get(T1, 'purchase.three_way.price_tolerance_abs')).toBe(1000);
    expect(await service.get(T1, 'purchase.three_way.price_tolerance_bp')).toBe(500);
  });

  it('returns the default for an unset key and a NotFound for an unknown key', async () => {
    const { service } = makeService(new FakeDb());
    expect(await service.get(T2, 'purchase.invoice_review.reviewer_rule')).toBe('always_differs');
    await expect(service.get(T2, 'nope.key')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.set(T2, owner, 'nope.key', true, 'x'.repeat(5))).rejects.toBeInstanceOf(NotFoundException);
  });
});
