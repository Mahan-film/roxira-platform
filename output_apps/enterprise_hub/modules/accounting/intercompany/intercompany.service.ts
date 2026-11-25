import { BadRequestException, Injectable } from '@nestjs/common';
import { roundMinorHalfUp } from '../money';
import {
  ConsolidatedBalanceSheet,
  ConsolidatedIncomeStatement,
  ConsolidationGroupConfig,
  ConsolidationResult,
  EliminationEntry,
  EntityBalance,
  EntityFinancialProfile,
  IntercompanyInvoiceInput,
  IntercompanyJournalEntry,
  IntercompanyPairResult,
  SCALE_1M,
} from './intercompany.types';

@Injectable()
export class IntercompanyService {
  /**
   * صدور همزمان صورتحساب بین‌شرکتی در شرکت صادرکننده و صورتحساب خرید متناظر (Mirror Bill) در شرکت دریافت‌کننده.
   */
  createIntercompanyPair(input: IntercompanyInvoiceInput): IntercompanyPairResult {
    if (input.amountMinor <= 0n) {
      throw new BadRequestException('مبلغ صورتحساب بین‌شرکتی باید بزرگتر از صفر باشد.');
    }
    if (input.sellerEntityId === input.buyerEntityId) {
      throw new BadRequestException('صادرکننده و دریافت‌کننده صورتحساب بین‌شرکتی نمی‌توانند یکسان باشند.');
    }

    const pairId = `IC-${input.date.replace(/-/g, '')}-${input.invoiceNumber}`;
    const recvCode = input.receivableAccountCode ?? '1150';
    const revCode = input.revenueAccountCode ?? '4100';
    const payCode = input.payableAccountCode ?? '2150';
    const expCode = input.expenseAccountCode ?? '6100';

    const sellerInvoiceEntry: IntercompanyJournalEntry = {
      entityId: input.sellerEntityId,
      entryNumber: input.invoiceNumber,
      date: input.date,
      description: input.description,
      pairId,
      counterpartyEntityId: input.buyerEntityId,
      counterpartyDocNumber: `BILL-${input.invoiceNumber}`,
      lines: [
        {
          accountCode: recvCode,
          accountName: 'حساب‌های دریافتنی بین‌شرکتی',
          category: 'ASSET',
          debitMinor: input.amountMinor,
          creditMinor: 0n,
          description: `${input.description} (مطالبه از شرکت وابسته)`,
        },
        {
          accountCode: revCode,
          accountName: 'درآمد بین‌شرکتی',
          category: 'REVENUE',
          debitMinor: 0n,
          creditMinor: input.amountMinor,
          description: `${input.description} (درآمد خدمات به شرکت وابسته)`,
        },
      ],
    };

    const buyerMirrorBillEntry: IntercompanyJournalEntry = {
      entityId: input.buyerEntityId,
      entryNumber: `BILL-${input.invoiceNumber}`,
      date: input.date,
      description: `صورتحساب متناظر خرید: ${input.description}`,
      pairId,
      counterpartyEntityId: input.sellerEntityId,
      counterpartyDocNumber: input.invoiceNumber,
      lines: [
        {
          accountCode: expCode,
          accountName: 'هزینه‌های بین‌شرکتی',
          category: 'EXPENSE',
          debitMinor: input.amountMinor,
          creditMinor: 0n,
          description: `${input.description} (هزینه خدمات از شرکت مادر)`,
        },
        {
          accountCode: payCode,
          accountName: 'حساب‌های پرداختنی بین‌شرکتی',
          category: 'LIABILITY',
          debitMinor: 0n,
          creditMinor: input.amountMinor,
          description: `${input.description} (بدهی به شرکت مادر)`,
        },
      ],
    };

    return {
      pairId,
      sellerInvoiceEntry,
      buyerMirrorBillEntry,
    };
  }

  /**
   * تجمیع صورت‌های مالی گروه (Consolidation) با حذف معاملات و مانده‌های درون‌گروهی (Eliminations)
   * و تفکیک حقوق اقلیت (Non-Controlling Interest - NCI).
   */
  consolidateGroup(
    config: ConsolidationGroupConfig,
    profiles: EntityFinancialProfile[],
  ): ConsolidationResult {
    const parentProfile = profiles.find((p) => p.entityId === config.parentEntityId);
    if (!parentProfile) {
      throw new BadRequestException(`اطلاعات مالی شرکت اصلی (Parent: ${config.parentEntityId}) یافت نشد.`);
    }

    const eliminations: EliminationEntry[] = [];
    let totalNciProfitShareMinor = 0n;
    let totalNciEquityAtAcquisitionMinor = 0n;

    // ثبت حذفیات و محاسبه حقوق اقلیت برای هر شرکت فرعی
    for (const subConfig of config.subsidiaries) {
      const subProfile = profiles.find((p) => p.entityId === subConfig.subsidiaryEntityId);
      if (!subProfile) {
        throw new BadRequestException(`اطلاعات مالی شرکت فرعی ${subConfig.subsidiaryEntityId} یافت نشد.`);
      }

      const icRecvCode = subConfig.intercompanyReceivableCode ?? '1150';
      const icPayCode = subConfig.intercompanyPayableCode ?? '2150';
      const icRevCode = subConfig.intercompanyRevenueCode ?? '4100';
      const icExpCode = subConfig.intercompanyExpenseCode ?? '6100';
      const investCode = subConfig.investmentAccountCode ?? '1500';
      const subEquityCode = subConfig.subsidiaryEquityAccountCode ?? '3000';
      const nciEquityCode = subConfig.nciEquityAccountCode ?? '3500';

      // ۱. شناسایی مانده‌های درون‌گروهی سود و زیان (IC Revenue & Expense)
      const parentIcRev = parentProfile.balances.find((b) => b.accountCode === icRevCode);
      const subIcExp = subProfile.balances.find((b) => b.accountCode === icExpCode);
      const icFeeAmount = parentIcRev ? parentIcRev.creditMinor : (subIcExp ? subIcExp.debitMinor : 0n);

      if (icFeeAmount > 0n) {
        eliminations.push({
          type: 'INTERCOMPANY_PL',
          description: `حذف درآمد و هزینه بین‌شرکتی بین ${parentProfile.entityName} و ${subProfile.entityName}`,
          lines: [
            {
              accountCode: icRevCode,
              accountName: 'درآمد بین‌شرکتی',
              category: 'REVENUE',
              debitMinor: icFeeAmount,
              creditMinor: 0n,
            },
            {
              accountCode: icExpCode,
              accountName: 'هزینه بین‌شرکتی',
              category: 'EXPENSE',
              debitMinor: 0n,
              creditMinor: icFeeAmount,
            },
          ],
        });
      }

      // ۲. شناسایی مانده‌های درون‌گروهی ترازنامه (IC Receivable & Payable)
      const parentIcRecv = parentProfile.balances.find((b) => b.accountCode === icRecvCode);
      const subIcPay = subProfile.balances.find((b) => b.accountCode === icPayCode);
      const icBalAmount = parentIcRecv ? parentIcRecv.debitMinor : (subIcPay ? subIcPay.creditMinor : 0n);

      if (icBalAmount > 0n) {
        eliminations.push({
          type: 'INTERCOMPANY_BS',
          description: `حذف مطالبات و بدهی‌های بین‌شرکتی بین ${parentProfile.entityName} و ${subProfile.entityName}`,
          lines: [
            {
              accountCode: icPayCode,
              accountName: 'حساب‌های پرداختنی بین‌شرکتی',
              category: 'LIABILITY',
              debitMinor: icBalAmount,
              creditMinor: 0n,
            },
            {
              accountCode: icRecvCode,
              accountName: 'حساب‌های دریافتنی بین‌شرکتی',
              category: 'ASSET',
              debitMinor: 0n,
              creditMinor: icBalAmount,
            },
          ],
        });
      }

      // ۳. حذف سرمایه‌گذاری شرکت مادر در برابر حقوق مالکانه شرکت فرعی در زمان تحصیل و شناسایی سهم اقلیت
      const acqEquity = subConfig.acquisitionEquityMinor;
      const investmentMinor = (acqEquity * subConfig.ownershipRatioScaled6) / SCALE_1M;
      const nciAcqEquity = acqEquity - investmentMinor;
      totalNciEquityAtAcquisitionMinor += nciAcqEquity;

      eliminations.push({
        type: 'INVESTMENT_EQUITY',
        description: `حذف بهای تمام‌شده سرمایه‌گذاری در ${subProfile.entityName} در برابر حقوق مالکانه زمان تحصیل و شناسایی سهم اقلیت`,
        lines: [
          {
            accountCode: subEquityCode,
            accountName: 'سرمایه شرکت فرعی (زمان تحصیل)',
            category: 'EQUITY',
            debitMinor: acqEquity,
            creditMinor: 0n,
          },
          {
            accountCode: investCode,
            accountName: 'سرمایه‌گذاری در شرکت فرعی',
            category: 'ASSET',
            debitMinor: 0n,
            creditMinor: investmentMinor,
          },
          {
            accountCode: nciEquityCode,
            accountName: 'حقوق اقلیت در زمان تحصیل (NCI Equity)',
            category: 'EQUITY',
            debitMinor: 0n,
            creditMinor: nciAcqEquity,
          },
        ],
      });

      // ۴. محاسبه سود خالص دوره شرکت فرعی پس از حذف درآمد/هزینه بین‌شرکتی و سهم اقلیت از سود
      const subTotalRev = subProfile.balances
        .filter((b) => b.category === 'REVENUE')
        .reduce((sum, b) => sum + b.creditMinor - b.debitMinor, 0n);
      const subTotalExp = subProfile.balances
        .filter((b) => b.category === 'EXPENSE')
        .reduce((sum, b) => sum + b.debitMinor - b.creditMinor, 0n);

      // سود خالص شرکت فرعی (درآمدها منهای هزینه‌ها)
      const subNetProfit = subTotalRev - subTotalExp;
      const nciRatioScaled6 = SCALE_1M - subConfig.ownershipRatioScaled6;
      const nciProfitShare = roundMinorHalfUp(subNetProfit * nciRatioScaled6, SCALE_1M);
      totalNciProfitShareMinor += nciProfitShare;
    }

    // ۵. تجمیع اقلام سود و زیان تجمیعی
    let totalExternalRevenueMinor = 0n;
    let totalExternalExpenseMinor = 0n;

    for (const profile of profiles) {
      for (const bal of profile.balances) {
        if (bal.category === 'REVENUE') {
          // اگر حساب درآمد بین‌شرکتی نباشد، به درآمدهای خارجی اضافه شود
          const isIc = config.subsidiaries.some(
            (s) => s.intercompanyRevenueCode === bal.accountCode || bal.accountCode === '4100',
          );
          if (!isIc) {
            totalExternalRevenueMinor += bal.creditMinor - bal.debitMinor;
          }
        } else if (bal.category === 'EXPENSE') {
          const isIc = config.subsidiaries.some(
            (s) => s.intercompanyExpenseCode === bal.accountCode || bal.accountCode === '6100',
          );
          if (!isIc) {
            totalExternalExpenseMinor += bal.debitMinor - bal.creditMinor;
          }
        }
      }
    }

    const consolidatedNetIncomeBeforeNciMinor =
      totalExternalRevenueMinor - totalExternalExpenseMinor;
    const controllingNetIncomeMinor =
      consolidatedNetIncomeBeforeNciMinor - totalNciProfitShareMinor;

    const incomeStatement: ConsolidatedIncomeStatement = {
      externalRevenueMinor: totalExternalRevenueMinor,
      externalExpenseMinor: totalExternalExpenseMinor,
      consolidatedNetIncomeBeforeNciMinor,
      nciShareMinor: totalNciProfitShareMinor,
      controllingNetIncomeMinor,
    };

    // ۶. تجمیع ترازنامه پس از حذفیات
    let totalAssetsMinor = 0n;
    let totalLiabilitiesMinor = 0n;
    let controllingShareCapitalMinor = 0n;

    for (const profile of profiles) {
      const isParent = profile.entityId === config.parentEntityId;
      for (const bal of profile.balances) {
        if (bal.category === 'ASSET') {
          // حذف مطالبات بین‌شرکتی و سرمایه‌گذاری در شرکت فرعی
          const isIcRecv = config.subsidiaries.some(
            (s) => s.intercompanyReceivableCode === bal.accountCode || bal.accountCode === '1150',
          );
          const isInvestment = config.subsidiaries.some(
            (s) => s.investmentAccountCode === bal.accountCode || bal.accountCode === '1500',
          );
          if (!isIcRecv && !isInvestment) {
            totalAssetsMinor += bal.debitMinor - bal.creditMinor;
          }
        } else if (bal.category === 'LIABILITY') {
          // حذف بدهی‌های بین‌شرکتی
          const isIcPay = config.subsidiaries.some(
            (s) => s.intercompanyPayableCode === bal.accountCode || bal.accountCode === '2150',
          );
          if (!isIcPay) {
            totalLiabilitiesMinor += bal.creditMinor - bal.debitMinor;
          }
        } else if (bal.category === 'EQUITY') {
          // فقط سرمایه شرکت مادر در حقوق صاحبان سهام منظور می‌شود (سرمایه شرکت فرعی حذف شد)
          if (isParent) {
            controllingShareCapitalMinor += bal.creditMinor - bal.debitMinor;
          }
        }
      }
    }

    const controllingEquityMinor =
      controllingShareCapitalMinor + controllingNetIncomeMinor;
    const totalNciEquityMinor =
      totalNciEquityAtAcquisitionMinor + totalNciProfitShareMinor;
    const totalEquityMinor = controllingEquityMinor + totalNciEquityMinor;

    const isBalanced =
      totalAssetsMinor === totalLiabilitiesMinor + totalEquityMinor;

    const balanceSheet: ConsolidatedBalanceSheet = {
      totalAssetsMinor,
      totalLiabilitiesMinor,
      controllingEquityMinor,
      nciEquityMinor: totalNciEquityMinor,
      totalEquityMinor,
      isBalanced,
    };

    return {
      groupId: config.groupId,
      eliminations,
      incomeStatement,
      balanceSheet,
      consolidatedBalances: [],
    };
  }
}
