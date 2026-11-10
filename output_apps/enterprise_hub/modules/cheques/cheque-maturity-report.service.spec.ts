import { ChequeMaturityReportService } from './services/cheque-maturity-report.service';
import { ChequesRepository } from './repositories/cheques.repository';
import { ChequeEntity } from './entities/cheque.entity';
import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import { SayadRegistrationStatus } from './sayad/sayad';

describe('ChequeMaturityReportService', () => {
  let service: ChequeMaturityReportService;
  let repo: Partial<ChequesRepository>;

  const mockCheques: Partial<ChequeEntity>[] = [
    {
      id: 1,
      chequeNumber: 'CHQ-001',
      sayadNumber: '1234567890123456',
      sayadRegistrationStatus: SayadRegistrationStatus.REGISTERED,
      direction: ChequeDirection.RECEIVED,
      status: ChequeStatus.REGISTERED,
      bankName: 'بانک ملت',
      partyName: 'شرکت آریا',
      partyCode: 'P-101',
      amount: '10000000.00',
      dueDate: '2026-11-05', // 3 days overdue (asOf 2026-11-08)
      issueDate: '2026-10-01',
    },
    {
      id: 2,
      chequeNumber: 'CHQ-002',
      sayadNumber: '2234567890123456',
      sayadRegistrationStatus: SayadRegistrationStatus.REGISTERED,
      direction: ChequeDirection.RECEIVED,
      status: ChequeStatus.REGISTERED,
      bankName: 'بانک ملی',
      partyName: 'شرکت بهار',
      partyCode: 'P-102',
      amount: '20000000.00',
      dueDate: '2026-11-08', // Due today
      issueDate: '2026-10-05',
    },
    {
      id: 3,
      chequeNumber: 'CHQ-003',
      sayadNumber: null,
      sayadRegistrationStatus: SayadRegistrationStatus.UNKNOWN,
      direction: ChequeDirection.RECEIVED,
      status: ChequeStatus.REGISTERED,
      bankName: 'بانک ملت',
      partyName: 'شرکت آریا',
      partyCode: 'P-101',
      amount: '30000000.00',
      dueDate: '2026-11-15', // Due in 7 days
      issueDate: '2026-10-10',
    },
    {
      id: 4,
      chequeNumber: 'CHQ-004',
      sayadNumber: null,
      sayadRegistrationStatus: SayadRegistrationStatus.UNREGISTERED,
      direction: ChequeDirection.ISSUED,
      status: ChequeStatus.REGISTERED,
      bankName: 'بانک صادرات',
      partyName: 'تأمین کننده البرز',
      partyCode: 'S-201',
      amount: '50000000.00',
      dueDate: '2026-12-10', // Due in 32 days
      issueDate: '2026-10-20',
    },
  ];

  beforeEach(() => {
    repo = {
      list: jest.fn().mockImplementation(async (tenantId, filter) => {
        return mockCheques.filter((c) => {
          if (filter?.direction && c.direction !== filter.direction) return false;
          return true;
        }) as ChequeEntity[];
      }),
    };
    service = new ChequeMaturityReportService(repo as ChequesRepository);
  });

  it('aggregates maturity buckets correctly against asOfDate', async () => {
    const report = await service.generateReport('tenant-1', {
      asOfDate: '2026-11-08',
      direction: 'all',
    });

    expect(report.summary.totalCount).toBe(4);
    expect(report.summary.totalAmountMinor).toBe('11000000000'); // 110,000,000.00 in minor units
    expect(report.summary.overdueCount).toBe(1);
    expect(report.summary.todayCount).toBe(1);
    expect(report.summary.upcomingCount).toBe(2);

    // Overdue 1-30 days bucket
    expect(report.buckets.overdue_1_30.count).toBe(1);
    expect(report.buckets.overdue_1_30.items[0].chequeNumber).toBe('CHQ-001');

    // Today bucket
    expect(report.buckets.today.count).toBe(1);
    expect(report.buckets.today.items[0].chequeNumber).toBe('CHQ-002');

    // Due 1-7 days bucket
    expect(report.buckets.due_1_7.count).toBe(1);
    expect(report.buckets.due_1_7.items[0].chequeNumber).toBe('CHQ-003');

    // Due 31-60 days bucket
    expect(report.buckets.due_31_60.count).toBe(1);
    expect(report.buckets.due_31_60.items[0].chequeNumber).toBe('CHQ-004');
  });

  it('filters by direction (received vs issued)', async () => {
    const report = await service.generateReport('tenant-1', {
      asOfDate: '2026-11-08',
      direction: 'received',
    });

    expect(report.summary.totalCount).toBe(3);
    expect(report.summary.totalAmountMinor).toBe('6000000000');
  });

  it('groups by bank and top parties', async () => {
    const report = await service.generateReport('tenant-1', {
      asOfDate: '2026-11-08',
    });

    // Bank grouping
    expect(report.byBank.length).toBe(3);
    const mellat = report.byBank.find((b) => b.bankName === 'بانک ملت');
    expect(mellat?.count).toBe(2);
    expect(mellat?.totalAmountMinor).toBe('4000000000');

    // Top party grouping
    expect(report.topParties.length).toBe(3);
    const alborz = report.topParties[0];
    expect(alborz.partyName).toBe('تأمین کننده البرز');
    expect(alborz.totalAmountMinor).toBe('5000000000');
  });

  it('handles full ISO datetime string without crashing and filters by bankName', async () => {
    const report = await service.generateReport('tenant-1', {
      asOfDate: '2026-11-08T12:34:56.789Z',
      bankName: 'ملت',
    });

    expect(repo.list).toHaveBeenCalledWith('tenant-1', { direction: undefined });
    expect(report.summary.totalCount).toBe(2);
    expect(report.summary.totalAmountMinor).toBe('4000000000');
  });

  it('nets settledAmount from partial payments', async () => {
    (repo.list as jest.Mock).mockResolvedValueOnce([
      {
        id: 10,
        chequeNumber: 'CHQ-PARTIAL',
        direction: ChequeDirection.RECEIVED,
        status: ChequeStatus.DEPOSITED,
        amount: '10000000.00',
        settledAmount: '3000000.00', // Unpaid remainder is 7,000,000.00
        dueDate: '2026-11-08',
      },
    ]);

    const report = await service.generateReport('tenant-1', { asOfDate: '2026-11-08' });
    expect(report.summary.totalCount).toBe(1);
    expect(report.summary.totalAmountMinor).toBe('700000000');
  });
});
