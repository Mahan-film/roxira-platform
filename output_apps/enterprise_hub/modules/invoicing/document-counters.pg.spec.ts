/**
 * Real PostgreSQL FORCE RLS and concurrency integration test for fin_document_counters (T321 / #1218):
 * - Connects as NOSUPERUSER NOBYPASSRLS (`roxira_app`).
 * - Verifies `fin_document_counters` has relrowsecurity = true and relforcerowsecurity = true.
 * - Verifies PostgresSequencerStore + GaplessNumberSequencer + VendorInvoiceGenerator.generateAsync:
 *   - sequential numbering inside TenantScope transactions,
 *   - concurrent Promise.all allocation has zero duplicates and zero gaps,
 *   - rolled-back transaction leaves no gap in the sequence,
 *   - strict cross-tenant isolation under FORCE RLS and rejection of unbound queries.
 */
import { BadRequestException } from '@nestjs/common';
import { Currency } from '../currency/enums/currency.enum';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as TENANT_A,
  TEST_T2 as TENANT_B,
} from '../../test/support/test-pg';
import {
  EffectiveTaxTreatmentRegistry,
  GaplessNumberSequencer,
  PostgresSequencerStore,
  VendorInvoiceGenerator,
} from './services/vendor-invoice.generator';

describePg('fin_document_counters & PostgresSequencerStore (NOSUPERUSER NOBYPASSRLS)', () => {
  let testDb: TestDatabaseContext;
  let store: PostgresSequencerStore;
  let sequencer: GaplessNumberSequencer;
  let generator: VendorInvoiceGenerator;

  beforeAll(async () => {
    testDb = await createTestDatabase('t321doccnt');
    store = new PostgresSequencerStore();
    sequencer = new GaplessNumberSequencer(store);
    generator = new VendorInvoiceGenerator(new EffectiveTaxTreatmentRegistry(), sequencer);
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('enables FORCE ROW LEVEL SECURITY on fin_document_counters', async () => {
    const [row] = await testDb.rawQuery<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname = 'fin_document_counters'`,
    );
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('allocates gapless consecutive numbers under concurrency and leaves no gap on rollback', async () => {
    const key = {
      tenantId: TENANT_A,
      documentType: 'INVOICE' as const,
      channel: 'WEB',
      fiscalYear: 2026,
      series: 'INV-2026',
    };

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        testDb.scope.run(TENANT_A, (manager) => store.nextNumber(key, manager)),
      ),
    );
    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    await expect(
      testDb.scope.run(TENANT_A, async (manager) => {
        const allocated = await store.nextNumber(key, manager);
        expect(allocated).toBe(9);
        throw new Error('simulated abort after counter increment');
      }),
    ).rejects.toThrow('simulated abort after counter increment');

    const doc = await testDb.scope.run(TENANT_A, (manager) =>
      generator.generateAsync(
        {
          tenantId: TENANT_A,
          documentType: 'INVOICE',
          series: 'INV-2026',
          channel: 'WEB',
          fiscalYear: 2026,
          issueDate: '2026-06-15',
          supplier: { name: 'Roxira Co', country: 'US', isB2B: true },
          customer: { name: 'Acme EU', country: 'DE', isB2B: true, verifiedTaxId: true },
          items: [{ description: 'Pro Plan', quantity: 1, unitPriceMinor: 10000n }],
          currency: Currency.EUR,
        },
        manager,
      ),
    );
    expect(doc.sequenceNumber).toBe(9);
    expect(doc.documentNumber).toBe('INV-2026-000009');
  });

  it('isolates counters per tenant under FORCE RLS and rejects tenant mismatch or bare access', async () => {
    const docB = await testDb.scope.run(TENANT_B, (manager) =>
      generator.generateAsync(
        {
          tenantId: TENANT_B,
          documentType: 'INVOICE',
          series: 'INV-2026',
          channel: 'WEB',
          fiscalYear: 2026,
          issueDate: '2026-06-15',
          supplier: { name: 'Roxira Co', country: 'US', isB2B: true },
          customer: { name: 'Tenant B Buyer', country: 'DE', isB2B: true, verifiedTaxId: true },
          items: [{ description: 'Pro Plan', quantity: 1, unitPriceMinor: 10000n }],
          currency: Currency.EUR,
        },
        manager,
      ),
    );
    expect(docB.sequenceNumber).toBe(1);

    const rowsA = await testDb.scope.run(TENANT_A, (manager) =>
      manager.query(`SELECT tenant_id, last_number FROM fin_document_counters`),
    );
    expect(rowsA.length).toBe(1);
    expect(rowsA[0].tenant_id).toBe(TENANT_A);

    await expect(
      testDb.scope.run(TENANT_A, (manager) =>
        store.nextNumber({ tenantId: TENANT_B, series: 'INV-2026' }, manager),
      ),
    ).rejects.toThrow(BadRequestException);

    // Bare app query without app.tenant_id sees no rows and cannot insert under FORCE RLS.
    expect(await testDb.app.query(`SELECT 1 FROM fin_document_counters`)).toEqual([]);
    await expect(
      testDb.app.query(
        `INSERT INTO fin_document_counters (tenant_id, document_type, channel, fiscal_year, series, last_number)
         VALUES ($1, 'INVOICE', 'WEB', 2026, 'RAW-UNBOUND', 1)`,
        [TENANT_A],
      ),
    ).rejects.toThrow();
  });
});
