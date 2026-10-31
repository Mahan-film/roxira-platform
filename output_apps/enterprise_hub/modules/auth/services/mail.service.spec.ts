import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: mockSendMail }) }));

describe('MailService.sendLeadNotice', () => {
  const lead = {
    id: 7,
    name: 'سارا',
    company: null,
    phone: '09121234567',
    email: 'sara@example.com',
    message: 'نیاز به دمو',
    source: 'contact',
    createdAt: new Date('2026-10-31T10:00:00.000Z'),
  };
  const service = new MailService({
    get: (_key: string, fallback?: string) => fallback,
  } as unknown as ConfigService);

  beforeEach(() => mockSendMail.mockReset());

  it('puts the contact details in the body and none in the subject', async () => {
    mockSendMail.mockResolvedValue({});

    await expect(service.sendLeadNotice('owner@roxira.net', lead)).resolves.toBe(true);

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('owner@roxira.net');
    expect(mail.subject).toBe('[LEAD] #7');
    expect(mail.text).toContain('09121234567');
    expect(mail.text).toContain('sara@example.com');
    expect(mail.text).toContain('نیاز به دمو');
  });

  it('reports failure instead of throwing', async () => {
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    await expect(service.sendLeadNotice('owner@roxira.net', lead)).resolves.toBe(false);
  });
});
