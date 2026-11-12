import { ConfigService } from '@nestjs/config';
import { AccessModule } from '../../access/catalogue';
import { AccessService } from '../../access/services/access.service';
import { ReceiptBotService, captureKindFor } from './services/receipt-bot.service';
import { ReceiptBotRepository, TelegramLinkedUser } from './repositories/receipt-bot.repository';
import { ReceiptBotRateLimiter } from './utils/receipt-bot-rate-limiter';
import { CaptureService } from '../../invoice_capture/services/capture.service';

describe('ReceiptBotService & RateLimiter Unit Tests', () => {
  let service: ReceiptBotService;
  let mockRepo: Partial<ReceiptBotRepository>;
  let mockCaptureService: Partial<CaptureService>;
  let mockConfig: Partial<ConfigService>;
  let mockAccessService: { resolve: jest.Mock };
  let rateLimiter: ReceiptBotRateLimiter;

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    rateLimiter = new ReceiptBotRateLimiter(60_000, 10);

    mockRepo = {
      createLinkCode: jest.fn().mockImplementation(async (tId, uId, code, expiresAt) => ({
        id: 'code-1',
        tenantId: tId,
        userId: uId,
        code,
        expiresAt,
        usedAt: null,
        createdAt: new Date(),
      })),
      consumeCode: jest.fn(),
      claimUpdate: jest.fn().mockResolvedValue(true),
      lookupLinkByTelegramId: jest.fn(),
      findLinkByTenantUser: jest.fn(),
      unlink: jest.fn(),
      updatePreferences: jest.fn(),
    };

    mockCaptureService = {
      create: jest.fn().mockResolvedValue({
        id: 'doc-12345678',
        tenantId,
        kind: 'purchase',
        status: 'draft',
      } as any),
    };

    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'RECEIPT_BOT_TOKEN') return '123456:test-bot-token';
        if (key === 'RECEIPT_BOT_API') return 'https://api.telegram.org';
        if (key === 'RECEIPT_BOT_USERNAME') return 'roxira_receipt_bot';
        if (key === 'ASSISTANT_ENABLED') return 'true';
        return undefined;
      }),
    };

    mockAccessService = {
      resolve: jest.fn().mockResolvedValue({
        userId,
        tenantId,
        membershipId: 'm-1',
        roleKey: 'accountant',
        customRoleId: null,
        permissions: new Set(['accounting:read', 'accounting:create', 'accounting:post']),
        entitledModules: new Set([AccessModule.ACCOUNTING]),
        branchId: null,
        branchScoped: false,
        require2fa: false,
        scope: { type: 'org', ids: [] },
        amountLimits: {},
        fieldVisibility: {},
      }),
    };

    service = new ReceiptBotService(
      mockRepo as ReceiptBotRepository,
      mockCaptureService as CaptureService,
      rateLimiter,
      mockConfig as ConfigService,
      mockAccessService as unknown as AccessService,
    );
  });

  describe('Rate Limiter', () => {
    it('allows up to 10 requests per minute and blocks subsequent ones', () => {
      const limiter = new ReceiptBotRateLimiter(60_000, 10);
      const userKey = 'tg_99999';

      for (let i = 0; i < 10; i++) {
        expect(limiter.isAllowed(userKey).allowed).toBe(true);
      }
      const outcome = limiter.isAllowed(userKey);
      expect(outcome.allowed).toBe(false);
      expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('isolates different users in rate limiting', () => {
      const limiter = new ReceiptBotRateLimiter(60_000, 10);
      for (let i = 0; i < 10; i++) {
        limiter.isAllowed('user_a');
      }
      expect(limiter.isAllowed('user_a').allowed).toBe(false);
      expect(limiter.isAllowed('user_b').allowed).toBe(true);
    });
  });

  describe('Link Code Management', () => {
    it('generates a 6-digit numeric code expiring in 10 minutes', async () => {
      const before = Date.now();
      const res = await service.generateLinkCode(tenantId, userId);

      expect(res.code).toMatch(/^\d{6}$/);
      const diffMs = res.expiresAt.getTime() - before;
      expect(diffMs).toBeGreaterThanOrEqual(599_000);
      expect(diffMs).toBeLessThanOrEqual(601_000);
      expect(res.botUsername).toBe('roxira_receipt_bot');
      expect(res.deepLink).toBe(`https://t.me/roxira_receipt_bot?start=${res.code}`);
      expect(mockRepo.createLinkCode).toHaveBeenCalledWith(
        tenantId,
        userId,
        res.code,
        expect.any(Date),
      );
    });

    it('returns unlinked status when user has no link record', async () => {
      (mockRepo.findLinkByTenantUser as jest.Mock).mockResolvedValue(null);

      const status = await service.getStatus(tenantId, userId);
      expect(status.linked).toBe(false);
      expect(status.telegramUsername).toBeNull();
      expect(status.defaultKind).toBe('petty_cash');
      expect(status.botConfigured).toBe(true);
    });

    it('returns linked status with platform details when user is linked', async () => {
      (mockRepo.findLinkByTenantUser as jest.Mock).mockResolvedValue({
        id: 'link-1',
        tenantId,
        userId,
        platform: 'telegram',
        telegramChatId: '12345',
        telegramUsername: 'roxi_user',
        defaultKind: 'purchase',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const status = await service.getStatus(tenantId, userId);
      expect(status.linked).toBe(true);
      expect(status.telegramUsername).toBe('roxi_user');
      expect(status.defaultKind).toBe('purchase');
    });

    it('unlinks user and updates preferences', async () => {
      (mockRepo.unlink as jest.Mock).mockResolvedValue(true);
      await service.unlink(tenantId, userId);
      expect(mockRepo.unlink).toHaveBeenCalledWith(tenantId, userId);

      (mockRepo.updatePreferences as jest.Mock).mockResolvedValue({
        id: 'link-1',
        tenantId,
        userId,
        defaultKind: 'purchase',
      });
      (mockRepo.findLinkByTenantUser as jest.Mock).mockResolvedValue({
        id: 'link-1',
        tenantId,
        userId,
        platform: 'telegram',
        telegramChatId: '12345',
        telegramUsername: 'roxi_user',
        defaultKind: 'purchase',
      });

      const updated = await service.updatePreferences(tenantId, userId, { defaultKind: 'purchase' });
      expect(mockRepo.updatePreferences).toHaveBeenCalledWith(tenantId, userId, 'purchase');
      expect(updated.defaultKind).toBe('purchase');
    });
  });

  describe('Telegram Webhook Handling', () => {
    let sentMessages: Array<{ chatId: number; text: string }> = [];

    beforeEach(() => {
      sentMessages = [];
      // Mock fetch for sendTelegramMessage and telegram file API
      service.setFetch((url: any, init?: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/sendMessage')) {
          const body = JSON.parse(init?.body as string);
          sentMessages.push({ chatId: body.chat_id, text: body.text });
          return Promise.resolve(new Response(JSON.stringify({ ok: true })));
        }
        if (urlStr.includes('/getFile')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                result: { file_path: 'photos/file_1.jpg' },
              }),
            ),
          );
        }
        if (urlStr.includes('/file/bot') && urlStr.includes('photos/file_1.jpg')) {
          const dummyBuffer = Buffer.from('fake-jpeg-binary-data');
          return Promise.resolve(new Response(dummyBuffer));
        }
        return Promise.reject(new Error(`Unhandled URL in test mock: ${urlStr}`));
      });
    });

    it('handles /start with no arguments by returning a welcome message', async () => {
      const outcome = await service.handleTelegramUpdate({
        update_id: 1,
        message: {
          message_id: 10,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Reza' },
          text: '/start',
        },
      });

      expect(outcome.status).toBe('greeted');
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].chatId).toBe(777);
      expect(sentMessages[0].text).toContain('به بات دریافت رسید رکسایرا خوش آمدید');
    });

    it('handles /start with 6-digit link code successfully', async () => {
      (mockRepo.consumeCode as jest.Mock).mockResolvedValue({
        status: 'linked',
        link: {
          tenantId,
          userId,
          defaultKind: 'petty_cash',
          telegramUsername: 'reza_kh',
        },
      });

      const outcome = await service.handleTelegramUpdate({
        update_id: 2,
        message: {
          message_id: 11,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Reza', username: 'reza_kh' },
          text: '/start 123456',
        },
      });

      expect(outcome.status).toBe('linked');
      expect(mockRepo.consumeCode).toHaveBeenCalledWith(
        '123456',
        '777',
        'reza_kh',
      );
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('حساب کاربری شما با موفقیت');
    });

    it('handles /start with invalid or expired link code', async () => {
      (mockRepo.consumeCode as jest.Mock).mockResolvedValue({ status: 'invalid', link: null });

      const outcome = await service.handleTelegramUpdate({
        update_id: 3,
        message: {
          message_id: 12,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Reza' },
          text: '/start 999999',
        },
      });

      expect(outcome.status).toBe('invalid_code');
      expect(sentMessages[0].text).toContain('نامعتبر است یا منقضی شده است');
    });

    it('handles photo receipt upload when user is unlinked', async () => {
      (mockRepo.lookupLinkByTelegramId as jest.Mock).mockResolvedValue(null);

      const outcome = await service.handleTelegramUpdate({
        update_id: 4,
        message: {
          message_id: 13,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Reza' },
          photo: [
            { file_id: 'small', file_unique_id: 'u1', width: 100, height: 100 },
            { file_id: 'large', file_unique_id: 'u2', width: 800, height: 800 },
          ],
        },
      });

      expect(outcome.status).toBe('not_linked');
      expect(sentMessages[0].text).toContain('حساب تلگرام شما هنوز به هیچ سازمانی در رکسایرا متصل نشده است');
      expect(mockCaptureService.create).not.toHaveBeenCalled();
    });

    it('handles photo receipt upload when user is linked and creates capture document', async () => {
      const linkedUser: TelegramLinkedUser = {
        tenantId,
        userId,
        defaultKind: 'petty_cash',
        telegramUsername: 'reza_kh',
      };
      (mockRepo.lookupLinkByTelegramId as jest.Mock).mockResolvedValue(linkedUser);

      const outcome = await service.handleTelegramUpdate({
        update_id: 5,
        message: {
          message_id: 14,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Reza' },
          photo: [
            { file_id: 'small', file_unique_id: 'u1', width: 100, height: 100 },
            { file_id: 'large_photo_id', file_unique_id: 'u2', width: 1024, height: 768 },
          ],
          caption: 'رسید بنزین اسنپ',
        },
      });

      expect(outcome.status).toBe('captured');
      expect(outcome.message).toBe('doc-12345678');
      expect(mockCaptureService.create).toHaveBeenCalledWith(
        tenantId,
        userId,
        expect.objectContaining({
          mimetype: 'image/jpeg',
          size: expect.any(Number),
        }),
        expect.objectContaining({
          kind: 'purchase', // capture only knows purchase|sales; see captureKindFor()
          text: 'رسید بنزین اسنپ [برچسب: تنخواه‌گردان]',
        }),
      );
      expect(sentMessages[0].text).toContain('رسید شما با موفقیت دریافت شد');
      expect(sentMessages[0].text).toContain('فاکتور خرید (برچسب: تنخواه‌گردان)');
      expect(sentMessages[0].text).toContain('doc-12345678');
    });

    it('enforces rate limit on incoming messages from the same chat', async () => {
      // Exhaust rate limiter
      for (let i = 0; i < 10; i++) {
        rateLimiter.isAllowed('888');
      }

      const outcome = await service.handleTelegramUpdate({
        update_id: 6,
        message: {
          message_id: 15,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 888, type: 'private' },
          from: { id: 888, first_name: 'Spammer' },
          text: '/start',
        },
      });

      expect(outcome.status).toBe('rate_limited');
      expect(sentMessages[0].text).toContain('تعداد پیام‌های ارسالی شما بیش از حد مجاز است');
    });

    it('derives the capture kind from the link default and keeps the label in sync', async () => {
      expect(captureKindFor('petty_cash')).toBe('purchase');
      expect(captureKindFor('purchase')).toBe('purchase');

      (mockRepo.lookupLinkByTelegramId as jest.Mock).mockResolvedValue({
        tenantId,
        userId,
        defaultKind: 'purchase',
        telegramUsername: null,
      });
      await service.handleTelegramUpdate({
        update_id: 20,
        message: {
          message_id: 30,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 555, type: 'private' },
          from: { id: 555, first_name: 'A' },
          photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10 }],
        },
      });
      expect(mockCaptureService.create).toHaveBeenCalledWith(
        tenantId,
        userId,
        expect.anything(),
        expect.objectContaining({ kind: 'purchase', text: '[فاکتور خرید]' }),
      );
      expect(sentMessages[0].text).toContain('فاکتور خرید');
    });

    it('blocks a chat after 5 failed link-code attempts without locking out unrelated chats', async () => {
      (mockRepo.consumeCode as jest.Mock).mockResolvedValue({ status: 'invalid', link: null });
      const send = (chatId: number, n: number) =>
        service.handleTelegramUpdate({
          update_id: 100 + n,
          message: {
            message_id: 100 + n,
            date: Math.floor(Date.now() / 1000),
            chat: { id: chatId, type: 'private' },
            // vary from.id to prove the per-chat key holds even when from.id is spoofed
            from: { id: 9000 + n, first_name: 'X' },
            text: String(100000 + n),
          },
        });

      for (let i = 0; i < 5; i++) {
        expect((await send(4242, i)).status).toBe('invalid_code');
      }
      const blocked = await send(4242, 5);
      expect(blocked.status).toBe('rate_limited');
      expect(mockRepo.consumeCode).toHaveBeenCalledTimes(5);

      // A separate legitimate chat must not be locked out by chat 4242's failures
      (mockRepo.consumeCode as jest.Mock).mockResolvedValueOnce({
        status: 'linked',
        link: { tenantId, userId, defaultKind: 'purchase', telegramUsername: 'legit' },
      });
      const otherChat = await service.handleTelegramUpdate({
        update_id: 199,
        message: {
          message_id: 199,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 7373, type: 'private' },
          from: { id: 7373, first_name: 'Legit' },
          text: '654321',
        },
      });
      expect(otherChat.status).toBe('linked');
    });

    it('ignores a retried delivery of the same update_id (no second capture)', async () => {
      (mockRepo.claimUpdate as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      (mockRepo.lookupLinkByTelegramId as jest.Mock).mockResolvedValue({
        tenantId,
        userId,
        defaultKind: 'petty_cash',
        telegramUsername: null,
      });
      const update = {
        update_id: 777001,
        message: {
          message_id: 40,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 321, type: 'private' as const },
          from: { id: 321, first_name: 'D' },
          photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10 }],
        },
      };
      expect((await service.handleTelegramUpdate(update)).status).toBe('captured');
      expect((await service.handleTelegramUpdate(update)).status).toBe('duplicate');
      expect(mockCaptureService.create).toHaveBeenCalledTimes(1);
      expect(mockRepo.claimUpdate).toHaveBeenCalledWith('123456', 777001);
    });

    it('never echoes raw error text to the chat when capture fails', async () => {
      (mockRepo.lookupLinkByTelegramId as jest.Mock).mockResolvedValue({
        tenantId,
        userId,
        defaultKind: 'purchase',
        telegramUsername: null,
      });
      (mockCaptureService.create as jest.Mock).mockRejectedValue(new Error('SECRET-INTERNAL-DETAIL db host x'));
      const outcome = await service.handleTelegramUpdate({
        update_id: 50,
        message: {
          message_id: 50,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 654, type: 'private' },
          from: { id: 654, first_name: 'E' },
          photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10 }],
        },
      });
      expect(outcome.status).toBe('capture_failed');
      expect(sentMessages[0].text).toContain('پردازش رسید با خطا مواجه شد');
      expect(sentMessages[0].text).not.toContain('SECRET-INTERNAL-DETAIL');
    });

    it('rejects photo ingest when user membership was removed or lacks accounting:create permission', async () => {
      (mockRepo.lookupLinkByTelegramId as jest.Mock).mockResolvedValue({
        tenantId,
        userId,
        defaultKind: 'purchase',
        telegramUsername: null,
      });

      const photoUpdate = (updateId: number) => ({
        update_id: updateId,
        message: {
          message_id: updateId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 991, type: 'private' as const },
          from: { id: 991, first_name: 'F' },
          photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10 }],
        },
      });

      // Removed / inactive member
      mockAccessService.resolve.mockResolvedValueOnce(null);
      expect((await service.handleTelegramUpdate(photoUpdate(60))).status).toBe('unauthorized');

      // Demoted role (read_only lacks accounting:create)
      mockAccessService.resolve.mockResolvedValueOnce({
        userId,
        tenantId,
        membershipId: 'm-1',
        roleKey: 'read_only',
        customRoleId: null,
        permissions: new Set(['accounting:read']),
        entitledModules: new Set([AccessModule.ACCOUNTING]),
        branchId: null,
        branchScoped: false,
        require2fa: false,
        scope: { type: 'org', ids: [] },
        amountLimits: {},
        fieldVisibility: {},
      });
      expect((await service.handleTelegramUpdate(photoUpdate(61))).status).toBe('unauthorized');
      expect(mockCaptureService.create).not.toHaveBeenCalled();
    });

    it('enforces the ASSISTANT_ENABLED kill switch on bot photo ingest', async () => {
      (mockConfig.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'RECEIPT_BOT_TOKEN') return '123456:test-bot-token';
        if (key === 'ASSISTANT_ENABLED') return 'false';
        return undefined;
      });

      const outcome = await service.handleTelegramUpdate({
        update_id: 62,
        message: {
          message_id: 62,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 992, type: 'private' },
          from: { id: 992, first_name: 'G' },
          photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10 }],
        },
      });

      expect(outcome.status).toBe('assistant_disabled');
      expect(mockCaptureService.create).not.toHaveBeenCalled();
      expect(sentMessages[0].text).toContain('غیرفعال است');
    });

    it('consumes a single rate-limit token per photo and rejects cross-tenant hijack code status', async () => {
      (mockRepo.lookupLinkByTelegramId as jest.Mock).mockResolvedValue({
        tenantId,
        userId,
        defaultKind: 'purchase',
        telegramUsername: null,
      });

      // 10 consecutive photos succeed (proves single token consumed per update), 11th is rate-limited
      for (let i = 0; i < 10; i++) {
        const res = await service.handleTelegramUpdate({
          update_id: 500 + i,
          message: {
            message_id: 500 + i,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 993, type: 'private' },
            from: { id: 993, first_name: 'H' },
            photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10 }],
          },
        });
        expect(res.status).toBe('captured');
      }
      const eleventh = await service.handleTelegramUpdate({
        update_id: 510,
        message: {
          message_id: 510,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 993, type: 'private' },
          from: { id: 993, first_name: 'H' },
          photo: [{ file_id: 'p', file_unique_id: 'u', width: 10, height: 10 }],
        },
      });
      expect(eleventh.status).toBe('rate_limited');

      // Cross-tenant hijack returns conflict message instead of silently unbinding
      (mockRepo.consumeCode as jest.Mock).mockResolvedValueOnce({
        status: 'already_linked_other_tenant',
        link: null,
      });
      const conflict = await service.handleTelegramUpdate({
        update_id: 511,
        message: {
          message_id: 511,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 994, type: 'private' },
          from: { id: 994, first_name: 'I' },
          text: '/start 654321',
        },
      });
      expect(conflict.status).toBe('already_linked_other_tenant');
      expect(sentMessages.at(-1)?.text).toContain('سازمان دیگری متصل است');
    });
  });
});
