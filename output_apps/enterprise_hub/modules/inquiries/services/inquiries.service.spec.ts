import { BadRequestException, Logger } from '@nestjs/common';
import { MailService } from '../../auth/services/mail.service';
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
  const mail = { sendLeadNotice: jest.fn() };
  let service: InquiriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LEAD_NOTIFY_EMAIL;
    mail.sendLeadNotice.mockResolvedValue(true);
    service = new InquiriesService(
      repository as unknown as InquiriesRepository,
      mail as unknown as MailService,
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

  it('accepts an inquiry with a phone number and no email', async () => {
    repository.create.mockResolvedValue(buildEntity());

    await service.create({ name: 'علی', phone: '09120000000' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: null, company: null }),
    );
  });

  it('rejects an invalid email address', async () => {
    await expect(
      service.create({ name: 'علی', phone: '09120000000', email: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  describe('lead notice', () => {
    const lead = { name: 'علی', phone: '09120000000', email: 'ali@example.com' };
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('mails the stored lead to LEAD_NOTIFY_EMAIL', async () => {
      process.env.LEAD_NOTIFY_EMAIL = ' owner@roxira.net ';
      const entity = buildEntity();
      repository.create.mockResolvedValue(entity);

      await service.create(lead);

      expect(mail.sendLeadNotice).toHaveBeenCalledWith('owner@roxira.net', entity);
    });

    it('sends nothing when the mailbox is unset or invalid', async () => {
      repository.create.mockResolvedValue(buildEntity());
      await service.create(lead);
      process.env.LEAD_NOTIFY_EMAIL = 'not-a-mailbox';
      await service.create(lead);
      expect(mail.sendLeadNotice).not.toHaveBeenCalled();
    });

    it('leaves upgrade leads to the frontend route that already mails them', async () => {
      process.env.LEAD_NOTIFY_EMAIL = 'owner@roxira.net';
      repository.create.mockResolvedValue(buildEntity({ source: 'upgrade-inquiry-pro' }));
      await service.create(lead);
      expect(mail.sendLeadNotice).not.toHaveBeenCalled();
    });

    it('answers before the mail finishes', async () => {
      process.env.LEAD_NOTIFY_EMAIL = 'owner@roxira.net';
      repository.create.mockResolvedValue(buildEntity());
      mail.sendLeadNotice.mockReturnValue(new Promise(() => undefined));
      await expect(service.create(lead)).resolves.toMatchObject({ id: 1 });
    });

    it.each([
      ['returns false', () => mail.sendLeadNotice.mockResolvedValue(false)],
      ['rejects', () => mail.sendLeadNotice.mockRejectedValue(new Error('smtp down'))],
    ])('keeps the form working and logs no contact data when mail %s', async (_, arrange) => {
      process.env.LEAD_NOTIFY_EMAIL = 'owner@roxira.net';
      arrange();
      repository.create.mockResolvedValue(buildEntity());
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await expect(service.create(lead)).resolves.toMatchObject({ id: 1 });
      await flush();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain('#1');
      for (const secret of ['سارا', '09121234567', 'sara@example.com']) {
        expect(logged).not.toContain(secret);
      }
      warnSpy.mockRestore();
    });
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
