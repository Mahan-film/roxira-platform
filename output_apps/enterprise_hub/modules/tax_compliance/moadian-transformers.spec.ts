import { Currency } from '../currency/enums/currency.enum';
import { InvoiceResponseDto } from '../invoicing/dto/invoice-response.dto';
import { InvoiceJurisdiction } from '../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import {
  MoadianBuyerType,
  MoadianInvoicePattern,
  MoadianInvoiceSubject,
  MoadianInvoiceType,
  MoadianSettlementMethod,
} from './enums/moadian.enum';
import { MoadianMappingContext } from './utils/moadian-packet.mapper';
import {
  MoadianPayloadTransformer,
  validateCounterpartyAgainstInvoiceType,
  MoadianCounterpartyValidationError,
} from './utils/moadian-payload.transformer';

describe('MoadianPayloadTransformer & Counterparty Validation (T70)', () => {
  const baseInvoice: InvoiceResponseDto = {
    id: 'inv-100',
    taxInvoiceNumber: 'T-100',
    direction: 'SALE' as never,
    einvoiceType: 1 as never,
    subject: 1 as never,
    relatedInvoiceId: null,
    warehouseId: null,
    customerId: null,
    status: InvoiceStatus.ISSUED,
    jurisdiction: InvoiceJurisdiction.IR,
    currency: Currency.IRR,
    exchangeRate: 1,
    fxRate: 1,
    amountFx: null,
    baseCurrency: Currency.IRR,
    totalAmount: 10000000,
    totalDiscount: 0,
    totalTax: 1000000,
    finalPayable: 11000000,
    baseTotalAmount: 10000000,
    baseTotalTax: 1000000,
    baseFinalPayable: 11000000,
    issuedAt: new Date('2026-11-10T12:00:00.000Z'),
    paidAt: null,
    journalEntryId: null,
    paidJournalEntryId: null,
    reversalJournalEntryId: null,
    postingError: null,
    createdAt: new Date('2026-11-10T12:00:00.000Z'),
    sellerInfo: {
      name: 'فروشنده تست',
      economicCode: '10101010101',
      nationalId: '10101010101',
    },
    buyerInfo: {
      name: 'خریدار حقوقی',
      economicCode: '14001234567',
      nationalId: '14001234567',
    },
    items: [
      {
        description: 'کالای تست ۱',
        quantity: 2,
        unitPrice: 5000000,
        vatRate: 0.1,
        tax: 1000000,
        discount: 0,
        total: 11000000,
      },
    ],
  } as unknown as InvoiceResponseDto;

  const baseContext: MoadianMappingContext = {
    memoryId: 'A1B2C3',
    sellerEconomicCode: '10101010101',
    serial: 100,
    defaultSstid: '1234567890123',
    defaultMeasurementUnit: '164',
    settlementMethod: MoadianSettlementMethod.CASH,
  };

  describe('Counterparty Type vs Invoice Type Validation', () => {
    it('allows legal person on Type 1 with 11-digit national ID', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITH_BUYER,
          MoadianBuyerType.LEGAL,
          { nationalId: '14001234567' },
        ),
      ).not.toThrow();
    });

    it('allows legal person on Type 1 with 14-digit economic code', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITH_BUYER,
          MoadianBuyerType.LEGAL,
          { economicCode: '14001234567890' },
        ),
      ).not.toThrow();
    });

    it('rejects legal person on Type 2 (without buyer)', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITHOUT_BUYER,
          MoadianBuyerType.LEGAL,
        ),
      ).toThrow(MoadianCounterpartyValidationError);
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITHOUT_BUYER,
          MoadianBuyerType.LEGAL,
        ),
      ).toThrow(/شخص حقوقی نمی‌تواند از نوع دوم/);
    });

    it('allows natural person on Type 1 with 10-digit national ID', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITH_BUYER,
          MoadianBuyerType.NATURAL,
          { nationalId: '0012345678' },
        ),
      ).not.toThrow();
    });

    it('rejects natural person on Type 1 with invalid length national ID', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITH_BUYER,
          MoadianBuyerType.NATURAL,
          { nationalId: '12345' },
        ),
      ).toThrow(/کد ملی ۱۰ رقمی/);
    });

    it('allows natural person on Type 2 (without buyer details)', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITHOUT_BUYER,
          MoadianBuyerType.NATURAL,
        ),
      ).not.toThrow();
    });

    it('allows foreign national on Type 1 with 12-digit comprehensive code', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITH_BUYER,
          MoadianBuyerType.FOREIGN_NATIONAL,
          { nationalId: '987654321012' },
        ),
      ).not.toThrow();
    });

    it('allows foreign national on Type 1 with passport number', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITH_BUYER,
          MoadianBuyerType.FOREIGN_NATIONAL,
          { passportNumber: 'P12345678' },
        ),
      ).not.toThrow();
    });

    it('rejects foreign national on Type 2', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITHOUT_BUYER,
          MoadianBuyerType.FOREIGN_NATIONAL,
        ),
      ).toThrow(/اتباع غیرایرانی نمی‌تواند از نوع دوم باشد/);
    });

    it('rejects civil partnership on Type 2', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.WITHOUT_BUYER,
          MoadianBuyerType.CIVIC,
        ),
      ).toThrow(/مشارکت مدنی نمی‌تواند از نوع دوم/);
    });

    it('rejects Type 3 (retail/POS)', () => {
      expect(() =>
        validateCounterpartyAgainstInvoiceType(
          MoadianInvoiceType.RETAIL,
          MoadianBuyerType.FINAL_CONSUMER,
        ),
      ).toThrow(/نوع ۳.*ارسال نمی‌شود/);
    });
  });

  describe('Pattern 1 (Sale) Transformer', () => {
    it('creates compliant Pattern 1 packet with computed line totals and taxes', () => {
      const packet = MoadianPayloadTransformer.transformPattern1Sale(baseInvoice, baseContext);
      expect(packet.header.inp).toBe(MoadianInvoicePattern.SALE);
      expect(packet.header.ins).toBe(MoadianInvoiceSubject.MAIN);
      expect(packet.header.inty).toBe(MoadianInvoiceType.WITH_BUYER);
      expect(packet.header.tprdis).toBe(10000000);
      expect(packet.header.tvam).toBe(1000000);
      expect(packet.header.tbill).toBe(11000000);
      expect(packet.body).toHaveLength(1);
      expect(packet.body[0].am).toBe(2);
      expect(packet.body[0].fee).toBe(5000000);
      expect(packet.body[0].vra).toBe(10);
    });
  });

  describe('Pattern 2 (Currency Sale) Transformer', () => {
    it('creates compliant Pattern 2 packet with currency fields', () => {
      const packet = MoadianPayloadTransformer.transformPattern2Currency(
        baseInvoice,
        baseContext,
        [
          {
            cfee: 100,
            cut: 'USD',
            exr: 500000,
            cpr: 450000,
            sovat: 5000000,
          },
        ],
      );
      expect(packet.header.inp).toBe(MoadianInvoicePattern.SALE_CURRENCY);
      expect(packet.body[0].cut).toBe('USD');
      expect(packet.body[0].cfee).toBe(100);
      expect(packet.body[0].exr).toBe(500000);
      expect(packet.body[0].cpr).toBe(450000);
      expect(packet.body[0].sovat).toBe(5000000);
      // In Pattern 2, am, fee, mu are dropped (null)
      expect(packet.body[0].am).toBeNull();
      expect(packet.body[0].fee).toBeNull();
    });

    it('rejects when cpr >= exr in Pattern 2', () => {
      expect(() =>
        MoadianPayloadTransformer.transformPattern2Currency(baseInvoice, baseContext, [
          {
            cfee: 100,
            cut: 'EUR',
            exr: 500000,
            cpr: 600000, // cpr must be < exr
            sovat: 5000000,
          },
        ]),
      ).toThrow(/cpr باید بزرگ‌تر از صفر و کوچک‌تر از exr باشد/);
    });
  });

  describe('Pattern 3 (Gold) Transformer', () => {
    it('creates compliant Pattern 3 packet calculating tcpbs wages', () => {
      const packet = MoadianPayloadTransformer.transformPattern3Gold(baseInvoice, baseContext, [
        {
          consfee: 200000,
          spro: 150000,
          bros: 50000,
          cop: 5000000,
          vop: 500000,
          cui: 750,
        },
      ]);
      expect(packet.header.inp).toBe(MoadianInvoicePattern.GOLD);
      expect(packet.body[0].consfee).toBe(200000);
      expect(packet.body[0].spro).toBe(150000);
      expect(packet.body[0].bros).toBe(50000);
      expect(packet.body[0].tcpbs).toBe(400000); // 200k + 150k + 50k
      expect(packet.body[0].cui).toBe(750);
    });
  });

  describe('Pattern 4 (Contract) Transformer', () => {
    it('creates compliant Pattern 4 packet with crn and bsrn', () => {
      const packet = MoadianPayloadTransformer.transformPattern4Contract(
        baseInvoice,
        baseContext,
        { crn: '123456789012' },
        [{ bsrn: '987654321012' }],
      );
      expect(packet.header.inp).toBe(MoadianInvoicePattern.CONTRACT);
      expect(packet.header.crn).toBe('123456789012');
      expect(packet.body[0].bsrn).toBe('987654321012');
    });

    it('rejects Pattern 4 when crn exceeds 12 digits or is missing', () => {
      expect(() =>
        MoadianPayloadTransformer.transformPattern4Contract(
          baseInvoice,
          baseContext,
          { crn: '12345678901234567' },
        ),
      ).toThrow(/شناسه یکتای قرارداد \(crn\)/);
    });
  });

  describe('Pattern 7 (Export) Transformer', () => {
    it('creates compliant export packet with zero VAT and customs fields', () => {
      const packet = MoadianPayloadTransformer.transformPattern7Export(
        baseInvoice,
        baseContext,
        {
          cdcn: 'KOTAJ-1234',
          cdcd: 14041,
          tonw: 500,
          torv: 10000000,
          tocv: 200,
        },
        [
          {
            cut: 'USD',
            exr: 50000,
            ssrv: 10000000,
            sscv: 200,
            nw: 500,
          },
        ],
      );
      expect(packet.header.inp).toBe(MoadianInvoicePattern.EXPORT);
      expect(packet.header.cdcn).toBe('KOTAJ-1234');
      expect(packet.body[0].vra).toBe(0);
      expect(packet.body[0].vam).toBe(0);
      expect(packet.header.tvam).toBe(0);
    });

    it('rejects corrective subject for Pattern 7 export', () => {
      expect(() =>
        MoadianPayloadTransformer.transformPattern7Export(
          baseInvoice,
          { ...baseContext, subject: MoadianInvoiceSubject.CORRECTIVE },
          { cdcn: '1234' },
          [{ cut: 'USD', exr: 50000, ssrv: 1000000, sscv: 20 }],
        ),
      ).toThrow(/صورتحساب اصلاحی \(موضوع ۲\) طبق دستورالعمل مودیان مجاز نیست/);
    });
  });

  describe('Invoice Subjects: Corrective, Cancellation, Return', () => {
    const validReferenceTaxId = 'A1B2C30510C00000000019';

    it('creates Corrective (اصلاحی) invoice with irtaxid', () => {
      const packet = MoadianPayloadTransformer.transformCorrective(
        baseInvoice,
        validReferenceTaxId,
        baseContext,
      );
      expect(packet.header.ins).toBe(MoadianInvoiceSubject.CORRECTIVE);
      expect(packet.header.irtaxid).toBe(validReferenceTaxId);
    });

    it('rejects Corrective invoice when irtaxid is not 22 characters', () => {
      expect(() =>
        MoadianPayloadTransformer.transformCorrective(baseInvoice, 'SHORT-ID', baseContext),
      ).toThrow(/دقیقاً ۲۲ کاراکتر/);
    });

    it('creates Cancellation (ابطالی) invoice with irtaxid', () => {
      const packet = MoadianPayloadTransformer.transformCancellation(
        baseInvoice,
        validReferenceTaxId,
        baseContext,
      );
      expect(packet.header.ins).toBe(MoadianInvoiceSubject.CANCELLATION);
      expect(packet.header.irtaxid).toBe(validReferenceTaxId);
    });

    it('creates Return (برگشت از فروش) invoice with irtaxid', () => {
      const packet = MoadianPayloadTransformer.transformReturn(
        baseInvoice,
        validReferenceTaxId,
        baseContext,
      );
      expect(packet.header.ins).toBe(MoadianInvoiceSubject.RETURN);
      expect(packet.header.irtaxid).toBe(validReferenceTaxId);
    });

    it('allows empty body on Cancellation per statutory regulations', () => {
      const emptyInvoice = { ...baseInvoice, items: [] };
      const packet = MoadianPayloadTransformer.transformCancellation(
        emptyInvoice,
        validReferenceTaxId,
        baseContext,
      );
      expect(packet.header.ins).toBe(MoadianInvoiceSubject.CANCELLATION);
      expect(packet.header.irtaxid).toBe(validReferenceTaxId);
      expect(packet.body).toHaveLength(0);
    });
  });
});
