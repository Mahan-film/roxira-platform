import { BadRequestException, Logger } from '@nestjs/common';
import { CreateInquiryDto } from '../dto/create-inquiry.dto';
import { EnterpriseInquiryEntity } from '../entities/enterprise-inquiry.entity';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { InquiriesRepository } from '../repositories/inquiries.repository';
import { InquiriesService } from './inquiries.service';

function buildEntity(
  overrides: Partial<EnterpriseInquiryEntity> = {},
): EnterpriseInquiryEntity {
  return {
    id: 1,
    tenantId: null,
    name: 'سارا محمدی',
    company: 'شرکت فناوری روکسیرا',
    phone: '09121234567',
    email: 'sara@example.com',
    message: null,
    source: 'home-early-access',
    status: InquiryStatus.NEW,
    createdAt: new Date('2026-10-14T12:00:00.000Z'),
    ...overrides,
  };
}

describe('InquiriesService', () => {
  const repository = {
    create: jest.fn(),
    findAndCount: jest.fn(),
  };
  let service: InquiriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SALES_NOTIFY_EMAIL;
    service = new InquiriesService(
      repository as unknown as InquiriesRepository,
    );
  });

  it('normalizes input and persists a public inquiry as NEW', async () => {
    repository.create.mockResolvedValue(buildEntity());

    const dto: CreateInquiryDto = {
      name: '  سارا محمدی  ',
      company: '  شرکت فناوری روکسیرا  ',
      phone: ' 09121234567 ',
      email: ' Sara@Example.COM ',
      message: '  نیاز به دمو  ',
      source: ' home-early-access ',
    };

    const result = await service.create(dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: null,
        name: 'سارا محمدی',
        company: 'شرکت فناوری روکسیرا',
        phone: '09121234567',
        email: 'sara@example.com',
        message: 'نیاز به دمو',
        source: 'home-early-access',
        status: InquiryStatus.NEW,
      }),
    );
    expect(result.id).toBe(1);
    expect(result.status).toBe(InquiryStatus.NEW);
  });

  it('falls back to the default source and null optionals', async () => {
    repository.create.mockResolvedValue(buildEntity({ source: 'enterprise-hub' }));

    await service.create({
      name: 'علی',
      phone: '09120000000',
      email: 'ali@example.com',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        company: null,
        message: null,
        source: 'enterprise-hub',
      }),
    );
  });

  it('rejects a blank name before touching the database', async () => {
    await expect(
      service.create({ name: '   ', phone: '09120000000', email: 'a@b.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone number', async () => {
    await expect(
      service.create({ name: 'علی', phone: '12', email: 'a@b.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid email address', async () => {
    await expect(
      service.create({ name: 'علی', phone: '09120000000', email: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('logs a sales notification when SALES_NOTIFY_EMAIL is set', async () => {
    process.env.SALES_NOTIFY_EMAIL = 'sales@roxira.ir';
    repository.create.mockResolvedValue(buildEntity());
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await service.create({
      name: 'علی',
      phone: '09120000000',
      email: 'ali@example.com',
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('sales@roxira.ir'),
    );
    logSpy.mockRestore();
  });

  it('does not log a notification when SALES_NOTIFY_EMAIL is unset', async () => {
    repository.create.mockResolvedValue(buildEntity());
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await service.create({
      name: 'علی',
      phone: '09120000000',
      email: 'ali@example.com',
    });

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('lists inquiries with pagination metadata', async () => {
    repository.findAndCount.mockResolvedValue([[buildEntity()], 1]);

    const result = await service.list({ page: 2, limit: 10 });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
    expect(result.data).toHaveLength(1);
  });

  describe('waitlist consent', () => {
    const base: CreateInquiryDto = {
      name: 'Aisyah',
      phone: '+60 12-345 6789',
      email: 'a@example.my',
      source: 'my-legal-waitlist',
    };

    it('rejects the Malaysia waitlist without explicit consent', async () => {
      await expect(service.create(base)).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ ...base, consent: false, consentVersion: 'v1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ ...base, consent: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('stores the consent version and time with the message', async () => {
      repository.create.mockResolvedValue(buildEntity());
      await service.create({
        ...base,
        message: 'Notes: x',
        consent: true,
        consentVersion: 'my-waitlist-consent-2026-10-23',
      });
      const saved = repository.create.mock.calls[0][0];
      expect(saved.message).toMatch(
        /^Notes: x\n\[consent: my-waitlist-consent-2026-10-23 at \d{4}-\d{2}-\d{2}T/,
      );
    });
  });
});
