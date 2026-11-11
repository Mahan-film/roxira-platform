import {
  SepidarChequesFifoAdapter,
} from './migration/bak/sepidar-cheques-fifo.adapter';
import {
  SYNTHETIC_SEPIDAR_CHEQUES,
  SYNTHETIC_SEPIDAR_FIFO_LAYERS,
  SepidarRawCheque,
  SepidarRawFifoBatch,
} from './__fixtures__/synthetic-sepidar-p2.fixture';
import { ChequeDirection, ChequeStatus } from '../cheques/enums/cheque.enum';

describe('Sepidar Migration Pipeline Part 2 (#231 / T79)', () => {
  let adapter: SepidarChequesFifoAdapter;

  beforeEach(() => {
    adapter = new SepidarChequesFifoAdapter();
  });

  describe('Sayad Number Validation & Digit Normalization', () => {
    it('accepts valid 16-digit Latin Sayad numbers', () => {
      const { validCheques, errors } = adapter.mapCheques([
        {
          ChequeId: 1,
          ChequeNumber: 'CHQ-1',
          SayadNumber: '1234567890123456',
          Direction: 'received',
          State: 'in_hand',
          Amount: 10000000,
          IssueDate: '2026-10-01',
          DueDate: '2026-11-01',
          PartyCode: 'P-1',
          PartyName: 'طرف حساب ۱',
          BankName: 'بانک ملت',
        },
      ]);

      expect(errors).toHaveLength(0);
      expect(validCheques).toHaveLength(1);
      expect(validCheques[0].sayadNumber).toBe('1234567890123456');
    });

    it('normalizes Persian and Arabic-Indic digits to 16 Latin digits', () => {
      const persianSayad = '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶';
      const { validCheques, errors } = adapter.mapCheques([
        {
          ChequeId: 2,
          ChequeNumber: 'CHQ-2',
          SayadNumber: persianSayad,
          Direction: 'received',
          State: 'in_hand',
          Amount: 20000000,
          IssueDate: '2026-10-01',
          DueDate: '2026-11-01',
          PartyCode: 'P-2',
          PartyName: 'طرف حساب ۲',
          BankName: 'بانک صادرات',
        },
      ]);

      expect(errors).toHaveLength(0);
      expect(validCheques).toHaveLength(1);
      expect(validCheques[0].sayadNumber).toBe('1234567890123456');
    });

    it('rejects invalid Sayad numbers (too short, too long, or repetitive placeholders)', () => {
      const invalidCheques: SepidarRawCheque[] = [
        {
          ChequeId: 10,
          ChequeNumber: 'CHQ-SHORT',
          SayadNumber: '12345678', // only 8 digits
          Direction: 'received',
          State: 'in_hand',
          Amount: 10000000,
          IssueDate: '2026-10-01',
          DueDate: '2026-11-01',
          PartyCode: 'P-1',
          PartyName: 'طرف حساب',
          BankName: 'بانک ملت',
        },
        {
          ChequeId: 11,
          ChequeNumber: 'CHQ-ZEROES',
          SayadNumber: '0000000000000000', // 16 zeroes (repeating placeholder)
          Direction: 'received',
          State: 'in_hand',
          Amount: 10000000,
          IssueDate: '2026-10-01',
          DueDate: '2026-11-01',
          PartyCode: 'P-1',
          PartyName: 'طرف حساب',
          BankName: 'بانک ملت',
        },
      ];

      const { validCheques, errors } = adapter.mapCheques(invalidCheques);
      expect(validCheques).toHaveLength(0);
      expect(errors).toHaveLength(2);
      expect(errors[0].reason).toContain('Invalid 16-digit Sayad');
      expect(errors[1].reason).toContain('Invalid 16-digit Sayad');
    });
  });

  describe('Open Cheques Filtering & Direction Mapping', () => {
    it('migrates only open cheques and filters cleared/bounced ones by default', () => {
      const { validCheques, errors } = adapter.mapCheques(SYNTHETIC_SEPIDAR_CHEQUES);

      expect(errors).toHaveLength(0);
      // In the synthetic fixture, 5 are open (3 received + 2 issued), 2 are cleared/bounced
      expect(validCheques).toHaveLength(5);

      const received = validCheques.filter((c) => c.direction === ChequeDirection.RECEIVED);
      const issued = validCheques.filter((c) => c.direction === ChequeDirection.ISSUED);

      expect(received).toHaveLength(3);
      expect(issued).toHaveLength(2);
    });

    it('rejects cheques with non-positive amounts', () => {
      const { validCheques, errors } = adapter.mapCheques([
        {
          ChequeId: 99,
          ChequeNumber: 'CHQ-ZERO-AMT',
          SayadNumber: '1234567890123456',
          Direction: 'received',
          State: 'in_hand',
          Amount: 0,
          IssueDate: '2026-10-01',
          DueDate: '2026-11-01',
          PartyCode: 'P-1',
          PartyName: 'طرف حساب',
          BankName: 'بانک ملت',
        },
      ]);

      expect(validCheques).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].reason).toContain('must be positive');
    });
  });

  describe('Cheque Endorsement & Status Tracking', () => {
    it('correctly tracks in-hand, deposited, and spent/endorsed received cheques', () => {
      const { validCheques } = adapter.mapCheques(SYNTHETIC_SEPIDAR_CHEQUES);

      const inHand = validCheques.find((c) => c.chequeNumber === 'CHQ-REC-001');
      expect(inHand).toBeDefined();
      expect(inHand?.status).toBe(ChequeStatus.REGISTERED);
      expect(inHand?.isEndorsed).toBe(false);

      const deposited = validCheques.find((c) => c.chequeNumber === 'CHQ-REC-002');
      expect(deposited).toBeDefined();
      expect(deposited?.status).toBe(ChequeStatus.DEPOSITED);
      expect(deposited?.isEndorsed).toBe(false);

      const spent = validCheques.find((c) => c.chequeNumber === 'CHQ-REC-003');
      expect(spent).toBeDefined();
      expect(spent?.status).toBe(ChequeStatus.SPENT);
      expect(spent?.isEndorsed).toBe(true);
      expect(spent?.spentToName).toBe('فولاد مبارکه اصفهان (نمونه)');
      expect(spent?.spentToCode).toBe('SUPP-001');
      expect(spent?.spentToNationalId).toBe('10260289456');
    });

    it('correctly tracks registered and delivered issued cheques', () => {
      const { validCheques } = adapter.mapCheques(SYNTHETIC_SEPIDAR_CHEQUES);

      const inBook = validCheques.find((c) => c.chequeNumber === 'CHQ-ISS-001');
      expect(inBook).toBeDefined();
      expect(inBook?.status).toBe(ChequeStatus.REGISTERED);

      const delivered = validCheques.find((c) => c.chequeNumber === 'CHQ-ISS-002');
      expect(delivered).toBeDefined();
      expect(delivered?.status).toBe(ChequeStatus.DELIVERED);
    });
  });

  describe('FIFO Opening Inventory Layers Mapping', () => {
    it('maps synthetic FIFO layers and preserves SKU, batch number, unit cost, and warehouse', () => {
      const { validLayers, errors } = adapter.mapFifoLayers(SYNTHETIC_SEPIDAR_FIFO_LAYERS);

      expect(errors).toHaveLength(0);
      expect(validLayers).toHaveLength(4);

      const steelBatch1 = validLayers.find((b) => b.batchNumber === 'BAT-2026-01');
      expect(steelBatch1).toBeDefined();
      expect(steelBatch1?.sku).toBe('SKU-STEEL-COIL');
      expect(steelBatch1?.warehouseId).toBe(1);
      expect(steelBatch1?.quantityRemaining).toBe(25.0);
      expect(steelBatch1?.unitPurchaseCost).toBe(120000000);
      expect(steelBatch1?.totalCostMinor).toBe(3000000000n); // 25 * 120M = 3,000,000,000 IRR
      expect(steelBatch1?.serialNumbers).toEqual(['SN-STL-01', 'SN-STL-02']);
    });

    it('sorts FIFO layers in chronological ascending order (oldest first)', () => {
      const { validLayers } = adapter.mapFifoLayers(SYNTHETIC_SEPIDAR_FIFO_LAYERS);

      for (let i = 1; i < validLayers.length; i++) {
        expect(validLayers[i].receivedDate.getTime()).toBeGreaterThanOrEqual(
          validLayers[i - 1].receivedDate.getTime(),
        );
      }
    });

    it('generates fallback batch number if missing', () => {
      const raw: SepidarRawFifoBatch[] = [
        {
          InventoryLayerId: 901,
          ItemCode: 'SKU-AUTO-BATCH',
          ItemTitle: 'کالای بدون شماره دسته',
          WarehouseId: 1,
          WarehouseTitle: 'انبار',
          BatchNumber: '', // empty
          Quantity: 10,
          UnitPurchaseCost: 5000000,
          ReceivedDate: '2026-05-01T10:00:00Z',
          PrimaryUnit: 'عدد',
        },
      ];

      const { validLayers, errors } = adapter.mapFifoLayers(raw);
      expect(errors).toHaveLength(0);
      expect(validLayers[0].batchNumber).toBe('OP-SKU-AUTO-BATCH-901');
    });

    it('rejects invalid inventory layers (negative cost, zero quantity, empty SKU)', () => {
      const invalidBatches: SepidarRawFifoBatch[] = [
        {
          InventoryLayerId: 1,
          ItemCode: '',
          ItemTitle: 'کالا بدون کد',
          WarehouseId: 1,
          WarehouseTitle: 'انبار',
          BatchNumber: 'B1',
          Quantity: 10,
          UnitPurchaseCost: 100,
          ReceivedDate: '2026-05-01T10:00:00Z',
          PrimaryUnit: 'عدد',
        },
        {
          InventoryLayerId: 2,
          ItemCode: 'SKU-NEG',
          ItemTitle: 'موجودی منفی',
          WarehouseId: 1,
          WarehouseTitle: 'انبار',
          BatchNumber: 'B2',
          Quantity: -5,
          UnitPurchaseCost: 100,
          ReceivedDate: '2026-05-01T10:00:00Z',
          PrimaryUnit: 'عدد',
        },
        {
          InventoryLayerId: 3,
          ItemCode: 'SKU-NEG-COST',
          ItemTitle: 'بهای تمام‌شده منفی',
          WarehouseId: 1,
          WarehouseTitle: 'انبار',
          BatchNumber: 'B3',
          Quantity: 5,
          UnitPurchaseCost: -100,
          ReceivedDate: '2026-05-01T10:00:00Z',
          PrimaryUnit: 'عدد',
        },
      ];

      const { validLayers, errors } = adapter.mapFifoLayers(invalidBatches);
      expect(validLayers).toHaveLength(0);
      expect(errors).toHaveLength(3);
    });
  });

  describe('Comprehensive Reconciliation Summary & Digital Signature', () => {
    it('calculates exact reconciliation summary and signs it with SHA-256', () => {
      const { validCheques } = adapter.mapCheques(SYNTHETIC_SEPIDAR_CHEQUES);
      const { validLayers } = adapter.mapFifoLayers(SYNTHETIC_SEPIDAR_FIFO_LAYERS);

      const summary = adapter.generateP2ReconciliationSummary(validCheques, validLayers);

      expect(summary.certifiedZeroVariance).toBe(true);
      expect(summary.cheques.totalOpenReceivedCount).toBe(3);
      // 150M + 280M + 95M = 525,000,000 IRR
      expect(summary.cheques.totalOpenReceivedAmountMinor).toBe(525000000n);

      expect(summary.cheques.totalOpenIssuedCount).toBe(2);
      // 320M + 110M = 430,000,000 IRR
      expect(summary.cheques.totalOpenIssuedAmountMinor).toBe(430000000n);

      expect(summary.cheques.totalEndorsedCount).toBe(1);
      expect(summary.cheques.totalEndorsedAmountMinor).toBe(95000000n);

      expect(summary.fifo.totalBatchLayersCount).toBe(4);
      // 25 * 120M (3,000M) + 15 * 125M (1,875M) + 50 * 45M (2,250M) + 100 * 18.5M (1,850M)
      // Total = 3,000 + 1,875 + 2,250 + 1,850 = 8,975,000,000 IRR
      expect(summary.fifo.totalInventoryValuationMinor).toBe(8975000000n);

      expect(summary.digitalSignatureSha256).toHaveLength(64);
    });
  });
});
