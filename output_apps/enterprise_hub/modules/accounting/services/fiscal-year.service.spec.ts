import { FiscalYearService } from './fiscal-year.service';
import { CalendarService } from '../../calendar';
import { FiscalYearEntity } from '../entities/fiscal-year.entity';
import { FiscalYearStatus } from '../enums/accounting.enum';

describe('FiscalYearService', () => {
  let service: FiscalYearService;
  let mockFiscalYears: any;

  beforeEach(() => {
    mockFiscalYears = {
      list: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
    };
    service = new FiscalYearService(
      {} as any,
      mockFiscalYears,
      {} as any,
      {} as any,
      new CalendarService(),
    );
  });

  it('list returns fiscal years with 12 explicit monthly periods', async () => {
    const entity: FiscalYearEntity = {
      id: 1,
      tenantId: 't1',
      name: '1405',
      startDate: '2026-03-21',
      endDate: '2027-03-20',
      status: FiscalYearStatus.OPEN,
      adjustmentPeriodOpen: false,
      closeSeq: 0,
      closedAt: null,
      closedBy: null,
      periodLockId: null,
      createdAt: new Date(),
    };
    mockFiscalYears.list.mockResolvedValue([entity]);

    const result = await service.list('t1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('1405');
    expect(result[0].periods).toBeDefined();
    expect(result[0].periods).toHaveLength(12);

    const p1 = result[0].periods![0];
    expect(p1.index).toBe(1);
    expect(p1.startDate).toBe('2026-03-21');
    expect(p1.endDate).toBe('2026-04-20');
    expect(p1.endDateExclusive).toBe('2026-04-21');

    const p12 = result[0].periods![11];
    expect(p12.index).toBe(12);
    expect(p12.startDate).toBe('2027-02-20');
    expect(p12.endDate).toBe('2027-03-20');
  });

  it('getPeriods returns explicit periods for a specific fiscal year', async () => {
    const entity: FiscalYearEntity = {
      id: 2,
      tenantId: 't1',
      name: '1404',
      startDate: '2025-03-21',
      endDate: '2026-03-20',
      status: FiscalYearStatus.CLOSED,
      adjustmentPeriodOpen: false,
      closeSeq: 1,
      closedAt: new Date(),
      closedBy: 'admin',
      periodLockId: 10,
      createdAt: new Date(),
    };
    mockFiscalYears.find.mockResolvedValue(entity);

    const periods = await service.getPeriods('t1', 2);
    expect(periods).toHaveLength(12);
    expect(periods[0].startDate).toBe('2025-03-21');
    expect(periods[0].endDate).toBe('2025-04-20');
  });
});
