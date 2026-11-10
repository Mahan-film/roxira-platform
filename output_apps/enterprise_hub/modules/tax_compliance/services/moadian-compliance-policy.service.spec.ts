import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PolicyService } from '../../tenants/policy/policy.service';
import {
  MoadianCompliancePolicyService,
  STATUTORY_DEFAULT_ARTICLE_6_CEILING_RIAL,
} from './moadian-compliance-policy.service';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('MoadianCompliancePolicyService', () => {
  let service: MoadianCompliancePolicyService;
  let policyValues: Record<string, unknown>;
  let mockInvoices: Array<{
    id: string;
    taxInvoiceNumber: string;
    issued_at: Date | string | null;
    createdAt: Date | string;
    finalPayable: number | string;
    sellerInfo?: { name?: string } | null;
    direction: 'SALE' | 'PURCHASE';
    status: string;
    paid_at: Date | string | null;
  }>;

  beforeEach(() => {
    policyValues = {
      'moadian.inbox_age_alert.mode': 'warn',
      'moadian.inbox_age_alert.warn_days': 20,
      'moadian.inbox_age_alert.critical_days': 27,
      'moadian.article_6_cap.mode': 'warn',
      'moadian.article_6_cap.warning_percent': 80,
      'moadian.article_6_cap.custom_ceiling_rial': 0,
    };
    mockInvoices = [];

    const fakePolicyService = {
      get: jest.fn(async (_tenantId: string, key: string) => policyValues[key]),
    } as unknown as PolicyService;

    const fakeManager = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        const s = sql.replace(/\s+/g, ' ').toLowerCase();

        // Inbox age query
        if (s.includes("direction\" = 'purchase'")) {
          const tenantId = params[0] as string;
          return mockInvoices
            .filter((inv) => inv.direction === 'PURCHASE' && ['DRAFT', 'ISSUED'].includes(inv.status) && !inv.paid_at)
            .map((inv) => ({
              id: inv.id,
              tax_invoice_number: inv.taxInvoiceNumber,
              issued_at: inv.issued_at,
              created_at: inv.createdAt,
              final_payable: inv.finalPayable,
              seller_info: inv.sellerInfo,
            }));
        }

        // Article 6 sales query
        if (s.includes("direction\" = 'sale'")) {
          const from = params[1] as Date;
          const to = params[2] as Date;
          const matchingSales = mockInvoices.filter((inv) => {
            if (inv.direction !== 'SALE' || !['ISSUED', 'PAID'].includes(inv.status)) return false;
            const date = new Date(inv.issued_at ?? inv.createdAt);
            return date >= from && date < to;
          });
          const total = matchingSales.reduce((sum, inv) => sum + Number(inv.finalPayable), 0);
          return [{ total_sales: total }];
        }

        return [];
      }),
    } as unknown as EntityManager;

    const fakeScope = {
      run: jest.fn(async (_tenantId: string, fn: (m: EntityManager) => Promise<unknown>) => fn(fakeManager)),
    } as unknown as TenantScope;

    service = new MoadianCompliancePolicyService(fakeScope, fakePolicyService);
  });

  describe('checkInboxAge (Moadian Inbox 30-Day Silent Acceptance Window)', () => {
    it('returns empty alerts and off mode when policy mode is off', () => {
      policyValues['moadian.inbox_age_alert.mode'] = 'off';
      return expect(service.checkInboxAge(TENANT)).resolves.toEqual(
        expect.objectContaining({
          mode: 'off',
          totalPending: 0,
          alerts: [],
        }),
      );
    });

    it('classifies purchase invoices into ok, warn (>= 20d) and critical (>= 27d)', async () => {
      const now = new Date('2026-11-09T12:00:00.000Z');
      const msDay = 86_400_000;

      // Invoice 1: 5 days old -> ok
      mockInvoices.push({
        id: 'inv-1',
        taxInvoiceNumber: 'PUR-001',
        issued_at: new Date(now.getTime() - 5 * msDay),
        createdAt: new Date(now.getTime() - 5 * msDay),
        finalPayable: 10_000_000,
        direction: 'PURCHASE',
        status: 'ISSUED',
        paid_at: null,
      });

      // Invoice 2: 21 days old -> warn
      mockInvoices.push({
        id: 'inv-2',
        taxInvoiceNumber: 'PUR-002',
        issued_at: new Date(now.getTime() - 21 * msDay),
        createdAt: new Date(now.getTime() - 21 * msDay),
        finalPayable: 25_000_000,
        sellerInfo: { name: 'تأمین‌کننده الف' },
        direction: 'PURCHASE',
        status: 'ISSUED',
        paid_at: null,
      });

      // Invoice 3: 28 days old -> critical (only 2 days left before 30-day auto accept)
      mockInvoices.push({
        id: 'inv-3',
        taxInvoiceNumber: 'PUR-003',
        issued_at: new Date(now.getTime() - 28 * msDay),
        createdAt: new Date(now.getTime() - 28 * msDay),
        finalPayable: 50_000_000,
        sellerInfo: { name: 'تأمین‌کننده ب' },
        direction: 'PURCHASE',
        status: 'ISSUED',
        paid_at: null,
      });

      const report = await service.checkInboxAge(TENANT, { asOf: now });

      expect(report.mode).toBe('warn');
      expect(report.totalPending).toBe(3);
      expect(report.warningCount).toBe(1);
      expect(report.criticalCount).toBe(1);
      expect(report.hasWarning).toBe(true);
      expect(report.hasCritical).toBe(true);

      expect(report.alerts[0].severity).toBe('ok');
      expect(report.alerts[0].ageDays).toBe(5);

      expect(report.alerts[1].severity).toBe('warn');
      expect(report.alerts[1].ageDays).toBe(21);
      expect(report.alerts[1].remainingDaysToAutoAccept).toBe(9);
      expect(report.alerts[1].messageFa).toContain('آستانه هشدار: 20 روز');

      expect(report.alerts[2].severity).toBe('critical');
      expect(report.alerts[2].ageDays).toBe(28);
      expect(report.alerts[2].remainingDaysToAutoAccept).toBe(2);
      expect(report.alerts[2].messageFa).toContain('تنها 2 روز تا تأیید خودکار قطعی سامانه مؤدیان باقی است');
    });
  });

  describe('checkArticle6SalesCap (Article 6 Sales Cap)', () => {
    it('returns off mode and allowed when policy mode is off', () => {
      policyValues['moadian.article_6_cap.mode'] = 'off';
      return expect(service.checkArticle6SalesCap(TENANT)).resolves.toEqual(
        expect.objectContaining({
          mode: 'off',
          allowed: true,
          isWarning: false,
          isExceeded: false,
        }),
      );
    });

    it('returns isWarning=false when sales volume is under 80%', async () => {
      const now = new Date('2026-11-09T12:00:00.000Z');
      // Ceiling is 7,200,000,000 Rial. 50% = 3,600,000,000 Rial.
      mockInvoices.push({
        id: 'sale-1',
        taxInvoiceNumber: 'INV-001',
        issued_at: now,
        createdAt: now,
        finalPayable: 3_600_000_000,
        direction: 'SALE',
        status: 'ISSUED',
        paid_at: null,
      });

      const report = await service.checkArticle6SalesCap(TENANT, { asOf: now });

      expect(report.mode).toBe('warn');
      expect(report.currentSalesRial).toBe('3600000000');
      expect(report.ceilingRial).toBe(STATUTORY_DEFAULT_ARTICLE_6_CEILING_RIAL.toString());
      expect(report.utilizationPercent).toBe(50);
      expect(report.isWarning).toBe(false);
      expect(report.isExceeded).toBe(false);
      expect(report.warningMessage).toBeNull();
      expect(report.allowed).toBe(true);
    });

    it('triggers proactive warning at 80% utilization with WARN default', async () => {
      const now = new Date('2026-11-09T12:00:00.000Z');
      // 82% of 7,200,000,000 Rial = 5,904,000,000 Rial.
      mockInvoices.push({
        id: 'sale-1',
        taxInvoiceNumber: 'INV-001',
        issued_at: now,
        createdAt: now,
        finalPayable: 5_904_000_000,
        direction: 'SALE',
        status: 'ISSUED',
        paid_at: null,
      });

      const report = await service.checkArticle6SalesCap(TENANT, { asOf: now });

      expect(report.utilizationPercent).toBe(82);
      expect(report.isWarning).toBe(true);
      expect(report.isExceeded).toBe(false);
      expect(report.warningMessage).toContain('میزان فروش دوره به 82٪ سقف مجاز مصوب رسیده است (آستانه هشدار: 80٪)');
      expect(report.allowed).toBe(true);
    });

    it('flags exceeded when sales reach 100%, and warns when mode is warn', async () => {
      const now = new Date('2026-11-09T12:00:00.000Z');
      // 100% of 7,200,000,000 Rial
      mockInvoices.push({
        id: 'sale-1',
        taxInvoiceNumber: 'INV-001',
        issued_at: now,
        createdAt: now,
        finalPayable: 7_500_000_000,
        direction: 'SALE',
        status: 'ISSUED',
        paid_at: null,
      });

      const report = await service.checkArticle6SalesCap(TENANT, { asOf: now });

      expect(report.isExceeded).toBe(true);
      expect(report.warningMessage).toContain('سقف مجاز صدور صورتحساب ماده ۶ تکمیل شده است');
      expect(report.allowed).toBe(true); // mode is warn -> allowed remains true
    });

    it('blocks issuance when mode is refuse and ceiling is exceeded', async () => {
      policyValues['moadian.article_6_cap.mode'] = 'refuse';
      const now = new Date('2026-11-09T12:00:00.000Z');

      mockInvoices.push({
        id: 'sale-1',
        taxInvoiceNumber: 'INV-001',
        issued_at: now,
        createdAt: now,
        finalPayable: 7_200_000_000,
        direction: 'SALE',
        status: 'ISSUED',
        paid_at: null,
      });

      const report = await service.checkArticle6SalesCap(TENANT, {
        asOf: now,
        newSalesAmountRial: 100_000_000,
      });

      expect(report.isExceeded).toBe(true);
      expect(report.allowed).toBe(false);

      await expect(
        service.assertCanIssueInvoice(TENANT, 100_000_000, { asOf: now }),
      ).rejects.toThrow(BadRequestException);
    });

    it('respects custom ceiling setting in policy', async () => {
      policyValues['moadian.article_6_cap.custom_ceiling_rial'] = 20_000_000_000;
      const now = new Date('2026-11-09T12:00:00.000Z');

      mockInvoices.push({
        id: 'sale-1',
        taxInvoiceNumber: 'INV-001',
        issued_at: now,
        createdAt: now,
        finalPayable: 10_000_000_000,
        direction: 'SALE',
        status: 'ISSUED',
        paid_at: null,
      });

      const report = await service.checkArticle6SalesCap(TENANT, { asOf: now });

      expect(report.ceilingRial).toBe('20000000000');
      expect(report.utilizationPercent).toBe(50);
      expect(report.isWarning).toBe(false);
    });
  });
});
