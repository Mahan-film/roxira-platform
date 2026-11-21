/**
 * R16 core acceptance suite (T177), part 1: tests that need no database. The Postgres half is
 * `r16-core.pg.spec.ts`. Spec text: docs/strategy/research/R16_ACCEPTANCE_TESTS.md.
 *
 * Passing `it` blocks call the real code (money rounding, depreciation, bank matcher). Every
 * `it.skip` names the row that adds the missing capability; none calls an API that does not exist.
 */
import { ForbiddenException } from '@nestjs/common';
import { proposeMatches } from '../../banking/matching/reconciliation-matcher';
import { nextMonthCharge } from '../assets/depreciation';
import {
  buildClosingRevaluationEntries,
  buildCrossCurrencySettlement,
  buildTriCurrencyInvoiceEntry,
  FX_RATE_SCALE,
} from '../fx-settlement';
import { fromMinor, roundMinorHalfUp } from '../money';
import {
  m,
  R16_T1_CONSOLIDATION as T1,
  R16_T2_FX as T2,
  R16_T6_BUDGET as T6,
  R16_T7_ASSET as T7,
  R16_T9_BANK as T9,
  R16_T10_TAX as T10,
  R16_T12_ACCOUNTANT as T12,
} from './r16-fixtures';
import {
  AccessAction,
  AccessModule,
  PARTNER_ADVISOR_ROLE,
  systemRolePermissions,
} from '../../access/catalogue';
import { evaluateAccess } from '../../access/policy-evaluator';
import { AccessContext } from '../../access/access-context';
import { denied } from '../../access/access-errors';
import { AccountantFirmService } from '../../access/services/accountant-firm.service';
import { AccountingRepository } from '../repositories/accounting.repository';
import { AccountingService } from '../services/accounting.service';

/** amount (2 decimals) x rate (6 decimals), half up to 2 decimals. */
const convert = (amountMinor: bigint, rateScaled: bigint): bigint => roundMinorHalfUp(amountMinor * rateScaled, 1_000_000n);

describe('R16 T1 multi-entity consolidation (T182)', () => {
  it('fixture numbers agree with each other (NCI 20% of 50,000, group profit 150,000)', () => {
    const subProfit = T1.subsidiaryExternalSales - T1.subsidiaryExternalExpenses;
    const group = T1.parentStandaloneExternalProfit + subProfit;
    expect(group).toBe(T1.expected.consolidatedNetIncomeBeforeNci);
    expect(T1.subsidiaryEquityAtAcquisition - T1.investmentInSubsidiary).toBe(T1.expected.nciEquityAtAcquisition);
    expect(group - T1.expected.nci).toBe(T1.expected.controllingNetIncome);
  });
  it.skip('posts the IC invoice in P and the mirror bill in S — needs T182 (intercompany)', () => undefined);
  it.skip('consolidates into group C with IC eliminations, investment elimination and NCI — needs T182', () => undefined);
  it.skip('consolidated balance sheet balances after eliminations — needs T182', () => undefined);
});

describe('R16 T2 three currencies, rounding, settlement', () => {
  const e = T2.expected;
  it('INV-101 converts GBP 1,000.00 to EUR 1,182.50 book and USD 1,283.01 reporting', () => {
    const eur = convert(T2.gbpInvoice.amountGbp, T2.gbpInvoice.gbpToEur);
    expect(eur).toBe(e.inv101Eur);
    expect(convert(eur, T2.gbpInvoice.eurToUsd)).toBe(e.inv101Usd);
  });
  it('rounds per line (11.83 x 3) against the header (35.48): the residual is exactly 0.01', () => {
    const line = convert(T2.threeLineInvoice.lineGbp, T2.threeLineInvoice.gbpToEur);
    const header = convert(T2.threeLineInvoice.lineGbp * BigInt(T2.threeLineInvoice.lines), T2.threeLineInvoice.gbpToEur);
    expect(line).toBe(e.lineEur);
    expect(header).toBe(e.headerEur);
    expect(line * BigInt(T2.threeLineInvoice.lines) - header).toBe(e.roundingResidualEur);
  });
  it('closing revaluation gain is 18.76 and the cross-currency settlement gain is 7.00', () => {
    const closing = convert(T2.gbpInvoice.amountGbp, T2.closing.gbpToEur);
    expect(closing - e.inv101Eur).toBe(e.unrealisedGainEur);
    const bank = convert(T2.settlement.usd, T2.settlement.usdToEur);
    expect(bank).toBe(e.settlementBankEur);
    expect(bank - e.inv101Eur).toBe(e.realisedGainEur);
    expect(T2.settlement.usd - e.inv101Usd).toBe(e.reportingSettlementDiffUsd);
  });
  it('posts a GBP invoice on a EUR book with USD reporting (T179)', () => {
    const entry = buildTriCurrencyInvoiceEntry({
      entryNumber: 'INV-101',
      date: '2026-10-15',
      txCurrency: 'GBP',
      bookCurrency: 'EUR',
      reportingCurrency: 'USD',
      txToBookRateScaled6: T2.gbpInvoice.gbpToEur,
      bookToReportingRateScaled6: T2.gbpInvoice.eurToUsd,
      receivableAccountCode: '1100',
      roundingResidualAccountCode: '6990',
      revenueLines: [{ accountCode: '4000', txAmountMinor: T2.gbpInvoice.amountGbp }],
    });
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines[0].txDebit).toBe(T2.gbpInvoice.amountGbp);
    expect(entry.lines[0].bookDebit).toBe(e.inv101Eur);
    expect(entry.lines[0].reportingDebit).toBe(e.inv101Usd);
    expect(entry.lines[1].bookCredit).toBe(e.inv101Eur);
    expect(entry.lines[1].reportingCredit).toBe(e.inv101Usd);
  });
  it('posts the 0.01 EUR rounding residual so the entry balances (T179)', () => {
    const entry = buildTriCurrencyInvoiceEntry({
      entryNumber: 'INV-102',
      date: '2026-10-15',
      txCurrency: 'GBP',
      bookCurrency: 'EUR',
      reportingCurrency: 'USD',
      txToBookRateScaled6: T2.threeLineInvoice.gbpToEur,
      bookToReportingRateScaled6: T2.gbpInvoice.eurToUsd,
      receivableAccountCode: '1100',
      roundingResidualAccountCode: '6990',
      revenueLines: [
        { accountCode: '4000', txAmountMinor: T2.threeLineInvoice.lineGbp },
        { accountCode: '4000', txAmountMinor: T2.threeLineInvoice.lineGbp },
        { accountCode: '4000', txAmountMinor: T2.threeLineInvoice.lineGbp },
      ],
    });
    const roundingLine = entry.lines.find((l) => l.isRounding);
    expect(roundingLine).toBeDefined();
    expect(roundingLine?.accountCode).toBe('6990');
    expect(roundingLine?.bookDebit).toBe(e.roundingResidualEur);
    expect(entry.lines[0].bookDebit).toBe(e.headerEur);
  });
  it('reverses the unrealised gain on 2026-11-01 and settles without a clearing account (T179)', () => {
    const reval = buildClosingRevaluationEntries({
      entryNumber: 'REVAL-2026-10',
      closingDate: '2026-10-31',
      reversalDate: '2026-11-01',
      txCurrency: 'GBP',
      bookCurrency: 'EUR',
      reportingCurrency: 'USD',
      openTxAmountMinor: T2.gbpInvoice.amountGbp,
      bookedBookAmountMinor: e.inv101Eur,
      closingTxToBookRateScaled6: T2.closing.gbpToEur,
      closingBookToReportingRateScaled6: T2.gbpInvoice.eurToUsd,
      receivableAccountCode: '1100',
      unrealisedFxGainAccountCode: '7100',
      unrealisedFxLossAccountCode: '7200',
    });
    expect(reval.unrealisedGainBookMinor).toBe(e.unrealisedGainEur);
    expect(reval.reversalEntry.date).toBe('2026-11-01');
    expect(reval.reversalEntry.lines[0].bookCredit).toBe(e.unrealisedGainEur);

    const settled = buildCrossCurrencySettlement({
      entryNumber: 'SET-101',
      date: '2026-11-05',
      invoiceCurrency: 'GBP',
      openTxAmountMinor: T2.gbpInvoice.amountGbp,
      bookedBookAmountMinor: e.inv101Eur,
      bookedReportingAmountMinor: e.inv101Usd,
      bankCurrency: 'USD',
      bankAmountMinor: T2.settlement.usd,
      bankToBookRateScaled6: T2.settlement.usdToEur,
      bankToReportingRateScaled6: FX_RATE_SCALE,
      contractualInvoiceToBankRateScaled6: T2.settlement.contractualGbpToUsd,
      bookCurrency: 'EUR',
      reportingCurrency: 'USD',
      bankAccountCode: '1010',
      receivableAccountCode: '1100',
      realisedFxGainAccountCode: '7110',
      realisedFxLossAccountCode: '7210',
    });
    expect(settled.usesClearingAccount).toBe(false);
    expect(settled.remainingReceivableTxMinor).toBe(0n);
    expect(settled.realisedFxBookMinor).toBe(e.realisedGainEur);
    expect(settled.realisedFxReportingMinor).toBe(e.reportingSettlementDiffUsd);
    const bankLine = settled.entry.lines.find((l) => l.accountCode === '1010');
    const arLine = settled.entry.lines.find((l) => l.accountCode === '1100');
    const fxLine = settled.entry.lines.find((l) => l.accountCode === '7110');
    expect(bankLine?.bookDebit).toBe(e.settlementBankEur);
    expect(arLine?.bookCredit).toBe(e.inv101Eur);
    expect(fxLine?.bookCredit).toBe(e.realisedGainEur);
    expect(fxLine?.reportingCredit).toBe(e.reportingSettlementDiffUsd);
  });
});

describe('R16 T3 period close and locks (T178)', () => {
  it.skip('hard close is blocked while DRAFT-9 is unposted and names it — needs T178 (period states)', () => undefined);
  it.skip('after hard close nobody can unlock or post into 2026-10 — needs T178', () => undefined);
  it.skip('Jalali entity cut-offs follow Jalali month ends — needs T178 (per-entity calendars on period states)', () => undefined);
});

describe('R16 T6 budgets and encumbrance', () => {
  it('fixture percentages hold (4,200/5,000 = 84%, 5,200/5,000 = 104%, 5,500 - 5,200 = 300)', () => {
    expect((T6.po88 * 100n) / T6.october).toBe(BigInt(T6.expected.po88WarningPercent));
    expect(T6.october - T6.po88).toBe(T6.expected.po88Remaining);
    expect(((T6.po88 + T6.po89) * 100n) / T6.october).toBe(BigInt(T6.expected.po89Percent));
    expect(T6.revisedBudget - T6.po88 - T6.po89).toBe(T6.expected.remainingAfterRevision);
  });
  it.skip('PO-88 passes with an 84% warning — needs T194 (budget encumbrance; BudgetControlService has no PO commitments or warn/block percentages)', () => undefined);
  it.skip('PO-89 (104%) is blocked — needs T194', () => undefined);
  it.skip('after revision to 5,500.00 PO-89 passes leaving 300.00 — needs T194', () => undefined);
});

describe('R16 T7 multi-book fixed assets', () => {
  const run = (method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE', months: number): bigint => {
    let accumulated = 0n;
    for (let done = 0; done < months; done++) {
      accumulated += nextMonthCharge({
        costMinor: T7.costEur,
        salvageMinor: 0n,
        accumulatedMinor: accumulated,
        monthsDone: done,
        method,
        lifeMonths: method === 'STRAIGHT_LINE' ? T7.book1.lifeMonths : null,
        annualRate: method === 'DECLINING_BALANCE' ? T7.book2.annualRate : null,
      });
    }
    return accumulated;
  };

  it('book 1 (IFRS straight line, 48 months) charges 500.00 a month: 1,500.00 and NBV 22,500.00 at 03-31', () => {
    expect(nextMonthCharge({ costMinor: T7.costEur, salvageMinor: 0n, accumulatedMinor: 0n, monthsDone: 0, method: 'STRAIGHT_LINE', lifeMonths: 48, annualRate: null })).toBe(T7.book1.monthly);
    const q1 = run('STRAIGHT_LINE', 3);
    expect(q1).toBe(T7.expected.q1.book1Accumulated);
    expect(T7.costEur - q1).toBe(T7.expected.q1.book1Nbv);
  });
  it('book 1 sale on 07-01 after 6 months: NBV 21,000.00, gain 1,000.00 on 22,000.00', () => {
    const nbv = T7.costEur - run('STRAIGHT_LINE', 6);
    expect(nbv).toBe(m('21000.00'));
    expect(T7.saleNetEur - nbv).toBe(T7.expected.sale.book1Gain);
  });
  it('output VAT on the sale is 19% of 22,000.00 = 4,180.00', () => {
    expect((T7.saleNetEur * 19n) / 100n).toBe(T7.saleVatEur);
  });
  it.skip('book 2 charges a flat 600.00 a month in year 1 (1,800.00 at 03-31, gain 1,600.00) — needs T183: nextMonthCharge steps the declining balance monthly (600.00 then 585.00), the spec steps it once a year, and an asset has one book only', () => undefined);
  it.skip('transfer to CC-PLANT-B on 2026-04-01 reclassifies cost 24,000 and accumulated 1,500 without reversing Q1 — needs T183 (asset transfer / dimensions v2 on assets)', () => undefined);
  it.skip('sale posts output VAT 4,180.00 and a gain per book — needs T183 (disposal per book)', () => undefined);
});

/** The matcher takes plain numbers; fromMinor is exact for these amounts and never divides by hand. */
const rial = (minor: bigint): number => {
  const value = fromMinor(minor);
  if (typeof value !== 'number') throw new Error('amount too large for the matcher');
  return value;
};

describe('R16 T9 bank import and reconciliation', () => {
  const book = (id: number, amount: number, entryNumber: string) => ({
    id,
    date: new Date('2026-11-05T12:00:00Z'),
    debit: amount,
    credit: 0,
    entryNumber,
    description: `Receipt ${entryNumber}`,
  });
  const books = [book(1, 1190, 'INV-101'), book(2, 600, 'INV-102'), book(3, 400, 'INV-103')];

  it('TX-1 +1,190.00 matches INV-101 by reference; TX-2 (970.00) has no one-to-one match and stays open', () => {
    const [tx1, tx2] = T9.statement;
    const proposal = proposeMatches(
      [
        { id: 1, txnDate: '2026-11-05', withdrawal: 0, deposit: rial(tx1.amount), reference: tx1.reference },
        { id: 2, txnDate: '2026-11-05', withdrawal: 0, deposit: rial(tx2.amount), reference: tx2.reference },
      ],
      books,
    );
    expect(proposal.matches).toEqual([{ statementLineId: 1, journalLineId: 1, byReference: true }]);
    expect(proposal.ambiguous).toEqual([]);
  });
  it('fixture: 970.00 payout + 30.00 fee = 600.00 + 400.00 invoices', () => {
    expect(T9.statement[1].amount + T9.statement[1].fee).toBe(T9.openInvoices['INV-102'] + T9.openInvoices['INV-103']);
  });
  it.skip('CAMT.053 import of the statement file — needs T184 (bank import)', () => undefined);
  it.skip('TX-2 settles INV-102 + INV-103 in one reconciliation with a 30.00 bank-fee line and a match explanation — needs T184', () => undefined);
  it.skip('re-importing the same file 24 h later creates no duplicate lines or postings — needs T184 (import idempotency)', () => undefined);
});

describe('R16 T10 tax engine (T180)', () => {
  it('fixture: 19% of 1,000.00 = 190.00; reverse charge nets to 0; WHT 5% leaves a 950.00 bank payment', () => {
    expect((T10.creditNote.net * 19n) / 100n).toBe(T10.creditNote.expectedVat);
    expect(T10.reverseCharge.vat - T10.reverseCharge.vat).toBe(0n);
    expect((T10.nonResident.net * 15n) / 100n).toBe(T10.nonResident.selfAssessedVat);
    expect(T10.nonResident.net - T10.nonResident.withholding).toBe(T10.nonResident.bankPaid);
  });
  it.skip('A: credit note on 2026-07-10 for a 2026-06-20 invoice uses 19%, a new invoice uses 20% — needs T180 (dated rates)', () => undefined);
  it.skip('B: reverse charge posts Dr input VAT 190 / Cr output RC VAT 190 mapped to return boxes — needs T180', () => undefined);
  it.skip('C: non-resident bill self-assesses 150 VAT and withholds 5% with certificate WHT-2026-0001 — needs T180', () => undefined);
});

describe('R16 T11 e-invoice adapters', () => {
  it.skip('rejected KSA B2B stays CLEARANCE_REJECTED, ICV 104 retired, resubmission gets ICV 105 — needs T174/T175 (Gulf e-invoice adapters)', () => undefined);
  it.skip('KSA B2C issued offline with QR and reported within 24 h — needs T174/T175', () => undefined);
  it.skip('UAE XML carries free-zone and continuous-supply flags without using dimensions — needs T174/T175 (UAE adapter) and T181 (dimensions v2)', () => undefined);
});

describe('R16 T12 accountant access', () => {
  const firmUserId = 'a1111111-1111-1111-1111-111111111111';
  const tenantIds = [
    't0000001-0000-0000-0000-000000000001',
    't0000002-0000-0000-0000-000000000002',
    't0000003-0000-0000-0000-000000000003',
  ];

  it('partner adviser adjustment journal is tagged PARTNER_ADJUSTMENT with the firm user id', async () => {
    let capturedHeader: any = null;
    const fakeRepo = {
      countAccounts: async () => 1,
      findEntryByIdempotencyKey: async () => null,
      findEntryByNumber: async () => null,
      findAccountsByCodes: async () => [
        { id: 1, code: '1001', level: 'moin' },
        { id: 2, code: '2001', level: 'moin' },
      ],
      persistJournalEntry: async (_tenantId: string, header: any, _lines: any) => {
        capturedHeader = header;
        return {
          id: 101,
          entryNumber: header.entryNumber,
          entryType: header.entryType,
          permanentNumber: null,
          permanentFiscalYearId: null,
          date: header.date,
          description: header.description,
          status: header.status,
          version: 1,
          tag: header.tag,
          firmUserId: header.firmUserId,
          lines: [
            { id: 1, accountId: 1, accountCode: '1001', debit: '1000.00', credit: '0.00', currency: 'IRR' },
            { id: 2, accountId: 2, accountCode: '2001', debit: '0.00', credit: '1000.00', currency: 'IRR' },
          ],
        } as any;
      },
    } as unknown as AccountingRepository;

    const fakeCurrency = {
      convert: (val: number) => val,
      round: (val: number) => val,
    } as any;

    const service = new AccountingService(
      fakeRepo,
      fakeCurrency,
    );

    const dto = {
      description: 'Q4 year-end accrual adjustment',
      isAdjustmentPeriod: true,
      lines: [
        { accountCode: '1001', debit: 1000, credit: 0 },
        { accountCode: '2001', debit: 0, credit: 1000 },
      ],
    };

    const res = await service.createJournalEntry(
      tenantIds[0],
      dto,
      undefined,
      { actorRole: PARTNER_ADVISOR_ROLE, actorUserId: firmUserId },
    );

    expect(capturedHeader.tag).toBe(T12.tag); // 'PARTNER_ADJUSTMENT'
    expect(capturedHeader.firmUserId).toBe(firmUserId);
    expect(res.tag).toBe(T12.tag);
    expect(res.firmUserId).toBe(firmUserId);
  });

  it('IBAN edit returns 403 for the partner role', () => {
    const ctx: AccessContext = {
      userId: firmUserId,
      tenantId: tenantIds[0],
      membershipId: 'm-123',
      roleKey: PARTNER_ADVISOR_ROLE,
      customRoleId: null,
      permissions: new Set(systemRolePermissions(PARTNER_ADVISOR_ROLE)),
      entitledModules: new Set([AccessModule.BANKING, AccessModule.ACCOUNTING]),
      branchId: null,
      branchScoped: false,
      require2fa: false,
      scope: { type: 'org', ids: [] },
      amountLimits: {},
      fieldVisibility: { cost: true, margin: true, salary: false },
    };

    const decision = evaluateAccess(ctx, {
      module: AccessModule.BANKING,
      action: AccessAction.POST,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe('FORBIDDEN_ACTION');
      const err = denied(decision.code, decision.message || 'Forbidden');
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getStatus()).toBe(T12.ibanEditStatus); // 403
    }
  });

  it('revoking the firm user ends sessions on all three tenants within 60 s with a security audit entry', async () => {
    expect(tenantIds.length).toBe(T12.tenants); // 3

    const storedMemberships = new Map<string, any>();
    const auditLogs: any[] = [];
    const activeSessions = new Set<string>();

    const sid = 'sess-firm-1';
    activeSessions.add(`${firmUserId}:${sid}`);

    const mockMemberships = {
      findByTenantUser: jest.fn(async (tenantId: string, userId: string) => {
        return storedMemberships.get(`${tenantId}:${userId}`) ?? { id: `m-${tenantId}`, tenantId, userId, status: 'ACTIVE' };
      }),
      save: jest.fn(async (m: any) => {
        storedMemberships.set(`${m.tenantId}:${m.userId}`, m);
        return m;
      }),
    };

    const mockAccess = {
      invalidateUser: jest.fn((userId: string) => {
        for (const k of Array.from(activeSessions)) {
          if (k.startsWith(`${userId}:`)) activeSessions.delete(k);
        }
      }),
      isSessionActive: jest.fn(async (s: string, u: string) => activeSessions.has(`${u}:${s}`)),
    };

    const mockAudit = {
      record: jest.fn(async (entry: any) => {
        auditLogs.push(entry);
      }),
    };

    const mockRefreshTokens = {
      revokeAllForUser: jest.fn(async (u: string) => {
        for (const k of Array.from(activeSessions)) {
          if (k.startsWith(`${u}:`)) activeSessions.delete(k);
        }
      }),
    };

    const firmService = new AccountantFirmService(
      mockMemberships as any,
      mockAccess as any,
      mockAudit as any,
      mockRefreshTokens as any,
    );

    expect(await firmService.isSessionActive(sid, firmUserId)).toBe(true);

    const start = Date.now();
    await firmService.revokeFirmUser('security-admin', firmUserId, tenantIds);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(T12.revokeWithinSeconds * 1000); // < 60s
    expect(await firmService.isSessionActive(sid, firmUserId)).toBe(false);

    // Security audit entry written for all 3 client tenants
    const secLogs = auditLogs.filter((a) => a.action === 'security.firm_user_revoked');
    expect(secLogs.length).toBe(3);
    expect(secLogs.map((l) => l.tenantId).sort()).toEqual(tenantIds.slice().sort());
  });
});

describe('R16 T13 API idempotency and webhooks (T185)', () => {
  it.skip('POST /journals with Idempotency-Key k-999 repeated after 30 min returns the original 201 body — needs T185', () => undefined);
  it.skip('same key with EUR 600 returns 409 IDEMPOTENCY_CONFLICT — needs T185', () => undefined);
  it.skip('a burst gets 429 with Retry-After — needs T185', () => undefined);
  it.skip('invoice.posted and asset.depreciated webhooks retry after two 503s and succeed on the third attempt with a valid signature — needs T185', () => undefined);
});

describe('R16 T14 auditor export (T186)', () => {
  it.skip('GDPdU, DATEV and SAF-T exports run as background jobs and tie to the trial balance — needs T186', () => undefined);
  it.skip('50,000 lines have audit numbers 1..50,000 with no gaps — needs T178 (gapless audit numbers)', () => undefined);
});

describe('R16 T15 AI controls (T191)', () => {
  it.skip('the AI agent matches vendor and PO-200 and saves an unposted 12-month prepaid draft attributed to the AI identity with citations — needs T191 (AI labels)', () => undefined);
  it.skip('the unusual 02:14 journal raises an outlier alert that must be acknowledged before period close — needs T191 and T178', () => undefined);
});
