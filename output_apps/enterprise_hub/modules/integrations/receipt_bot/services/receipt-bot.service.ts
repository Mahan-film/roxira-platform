import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { CaptureService, UploadedCaptureFile } from '../../../invoice_capture/services/capture.service';
import {
  GenerateLinkCodeResponseDto,
  ReceiptBotStatusResponseDto,
  TelegramUpdateDto,
  UpdateReceiptBotPreferencesDto,
} from '../dto/receipt-bot.dto';
import { ReceiptBotRepository } from '../repositories/receipt-bot.repository';
import { ReceiptBotRateLimiter } from '../utils/receipt-bot-rate-limiter';

/**
 * Capture documents only support the `purchase` / `sales` kinds. The link's `defaultKind`
 * (`purchase` | `petty_cash`) is mapped here: both are expense-side documents, so both map to
 * `purchase`; the petty-cash distinction is carried in the user text/label sent to extraction.
 */
export function captureKindFor(defaultKind: 'petty_cash' | 'purchase'): 'purchase' | 'sales' {
  switch (defaultKind) {
    case 'petty_cash':
    case 'purchase':
    default:
      return 'purchase';
  }
}

export type FetchFunction = typeof fetch;

@Injectable()
export class ReceiptBotService {
  private readonly logger = new Logger(ReceiptBotService.name);
  private fetchFn: FetchFunction = globalThis.fetch;
  /**
   * Failed link-code attempts. A 6-digit code is brute-forceable, so failures are capped per chat
   * and, as a backstop, globally for the whole process.
   */
  private readonly failedCodeByChat = new ReceiptBotRateLimiter(15 * 60_000, 5);
  private readonly failedCodeGlobal = new ReceiptBotRateLimiter(10 * 60_000, 100);

  constructor(
    private readonly repository: ReceiptBotRepository,
    private readonly captureService: CaptureService,
    private readonly rateLimiter: ReceiptBotRateLimiter,
    private readonly config: ConfigService,
  ) {}

  /** Allow overriding fetch for testing */
  setFetch(fn: FetchFunction): void {
    this.fetchFn = fn;
  }

  private botToken(): string | null {
    const token = this.config.get<string>('RECEIPT_BOT_TOKEN') ?? process.env.RECEIPT_BOT_TOKEN;
    return token?.trim() ? token.trim() : null;
  }

  private botApiBase(): string {
    const raw =
      this.config.get<string>('RECEIPT_BOT_API') ??
      process.env.RECEIPT_BOT_API ??
      'https://api.telegram.org';
    return raw.replace(/\/+$/, '');
  }

  private botUsername(): string | null {
    const u =
      this.config.get<string>('RECEIPT_BOT_USERNAME') ??
      process.env.RECEIPT_BOT_USERNAME;
    return u?.trim() ? u.trim().replace(/^@/, '') : null;
  }

  async generateLinkCode(tenantId: string, userId: string): Promise<GenerateLinkCodeResponseDto> {
    const code = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await this.repository.createLinkCode(tenantId, userId, code, expiresAt);

    const botUsername = this.botUsername();
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${code}` : null;

    return {
      code,
      expiresAt,
      botUsername,
      deepLink,
    };
  }

  async getStatus(tenantId: string, userId: string): Promise<ReceiptBotStatusResponseDto> {
    const link = await this.repository.findLinkByTenantUser(tenantId, userId);
    const token = this.botToken();
    const botUsername = this.botUsername();

    return {
      linked: link !== null,
      telegramUsername: link?.telegramUsername ?? null,
      defaultKind: link?.defaultKind ?? 'petty_cash',
      botConfigured: token !== null,
      botUsername,
    };
  }

  async unlink(tenantId: string, userId: string): Promise<boolean> {
    const done = await this.repository.unlink(tenantId, userId);
    if (!done) {
      throw new NotFoundException('اتصال به ربات برای این کاربر یافت نشد.');
    }
    return true;
  }

  async updatePreferences(
    tenantId: string,
    userId: string,
    dto: UpdateReceiptBotPreferencesDto,
  ): Promise<ReceiptBotStatusResponseDto> {
    const updated = await this.repository.updatePreferences(tenantId, userId, dto.defaultKind);
    if (!updated) {
      throw new NotFoundException('ابتدا باید حساب خود را به ربات متصل کنید.');
    }
    return this.getStatus(tenantId, userId);
  }

  // ---------------------------------------------------------------------------
  // Webhook handling
  // ---------------------------------------------------------------------------

  async handleTelegramUpdate(update: TelegramUpdateDto): Promise<{ status: string; message?: string }> {
    const msg = update.message;
    if (!msg) return { status: 'ignored' };

    const chatId = msg.chat.id;
    const telegramUserId = String(msg.from?.id ?? chatId);
    const telegramUsername = msg.from?.username;

    // Rate limit check
    const rateCheck = this.rateLimiter.isAllowed(telegramUserId);
    if (!rateCheck.allowed) {
      await this.sendTelegramMessage(
        chatId,
        `⚠️ تعداد پیام‌های ارسالی شما بیش از حد مجاز است. لطفاً ${rateCheck.retryAfterSeconds} ثانیه دیگر تلاش فرمایید.`,
      );
      return { status: 'rate_limited' };
    }

    // 1. Text commands / Link code
    const text = (msg.text ?? '').trim();
    if (text) {
      return this.handleTextMessage(chatId, telegramUserId, telegramUsername, text);
    }

    // 2. Photo / Document (Image receipt)
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const isImageDoc =
      msg.document &&
      (msg.document.mime_type?.startsWith('image/') ||
        msg.document.file_name?.match(/\.(jpe?g|png|webp|heic)$/i));

    if (hasPhoto || isImageDoc) {
      return this.handlePhotoMessage(chatId, telegramUserId, msg);
    }

    return { status: 'ignored' };
  }

  private async handleTextMessage(
    chatId: number,
    telegramUserId: string,
    telegramUsername: string | undefined,
    text: string,
  ): Promise<{ status: string; message?: string }> {
    // Match /start <code> or raw 6-digit code
    let code: string | null = null;
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      if (parts.length > 1 && /^\d{6}$/.test(parts[1])) {
        code = parts[1];
      }
    } else if (/^\d{6}$/.test(text)) {
      code = text;
    }

    if (code) {
      const chatKey = `chat:${chatId}`;
      const userKey = `user:${telegramUserId}`;
      const blocked = [
        this.failedCodeByChat.isBlocked(chatKey),
        this.failedCodeByChat.isBlocked(userKey),
        this.failedCodeGlobal.isBlocked('global'),
      ].find((r) => !r.allowed);
      if (blocked) {
        await this.sendTelegramMessage(
          chatId,
          `⚠️ تعداد تلاش‌های ناموفق اتصال بیش از حد مجاز است. لطفاً ${blocked.retryAfterSeconds} ثانیه دیگر تلاش فرمایید.`,
        );
        return { status: 'rate_limited' };
      }
      const linked = await this.repository.consumeCode(code, telegramUserId, telegramUsername);
      if (linked) {
        await this.sendTelegramMessage(
          chatId,
          '🎉 حساب کاربری شما با موفقیت به سازمان در سامانه رکسایرا متصل شد!\n\n' +
            'از این پس می‌توانید عکس فاکتورها و رسیدهای هزینه‌ای خود را به این ربات ارسال کنید تا به صورت خودکار پیش‌نویس سند در سیستم ثبت گردد.',
        );
        return { status: 'linked', message: 'User linked successfully' };
      }
      this.failedCodeByChat.record(chatKey);
      this.failedCodeByChat.record(userKey);
      this.failedCodeGlobal.record('global');
      await this.sendTelegramMessage(
        chatId,
        '❌ کد وارد شده نامعتبر است یا منقضی شده است.\nلطفاً از پنل رکسایرا در بخش «تنظیمات > بات دریافت رسید» کد جدیدی دریافت فرمایید.',
      );
      return { status: 'invalid_code' };
    }

    if (text.startsWith('/start')) {
      const existing = await this.repository.lookupLinkByTelegramId(telegramUserId);
      if (existing) {
        await this.sendTelegramMessage(
          chatId,
          'حساب شما قبلاً به رکسایرا متصل شده است. لطفاً عکس رسید یا فاکتور خود را ارسال فرمایید.',
        );
        return { status: 'already_linked' };
      }
      await this.sendTelegramMessage(
        chatId,
        'سلام! به بات دریافت رسید رکسایرا خوش آمدید. 👋\n\n' +
          'جهت اتصال این ربات به حساب کاربری خود، وارد پنل رکسایرا شده و از بخش «تنظیمات > بات دریافت رسید» کد ۶ رقمی اتصال را دریافت کرده و در اینجا ارسال فرمایید.',
      );
      return { status: 'greeted' };
    }

    return { status: 'ignored' };
  }

  private async handlePhotoMessage(
    chatId: number,
    telegramUserId: string,
    msg: NonNullable<TelegramUpdateDto['message']>,
  ): Promise<{ status: string; message?: string }> {
    // Rate limit check
    const rateCheck = this.rateLimiter.isAllowed(telegramUserId);
    if (!rateCheck.allowed) {
      await this.sendTelegramMessage(
        chatId,
        `⚠️ شما به سقف ارسال رسید در دقیقه رسیده‌اید. لطفاً ${rateCheck.retryAfterSeconds} ثانیه دیگر تلاش فرمایید.`,
      );
      return { status: 'rate_limited' };
    }

    // Lookup user link
    const link = await this.repository.lookupLinkByTelegramId(telegramUserId);
    if (!link) {
      await this.sendTelegramMessage(
        chatId,
        '⚠️ حساب تلگرام شما هنوز به هیچ سازمانی در رکسایرا متصل نشده است.\nلطفاً ابتدا از پنل رکسایرا کد اتصال یکبار مصرف دریافت کنید و به این ربات بفرستید.',
      );
      return { status: 'not_linked' };
    }

    // Pick file ID
    let fileId: string;
    let fileName = 'receipt.jpg';
    let mimeType = 'image/jpeg';

    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      // Highest resolution is last
      const best = msg.photo[msg.photo.length - 1];
      fileId = best.file_id;
    } else if (msg.document) {
      fileId = msg.document.file_id;
      if (msg.document.file_name) fileName = msg.document.file_name;
      if (msg.document.mime_type) mimeType = msg.document.mime_type;
    } else {
      return { status: 'no_photo' };
    }

    // Download file from Telegram
    let fileBuffer: Buffer;
    try {
      fileBuffer = await this.downloadTelegramFile(fileId);
    } catch (err) {
      this.logger.error(`Failed to download telegram file ${fileId}: ${(err as Error).message}`);
      await this.sendTelegramMessage(chatId, '❌ دریافت فایل از سرور پیام‌رسان با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
      return { status: 'download_failed' };
    }

    const uploadedFile: UploadedCaptureFile = {
      buffer: fileBuffer,
      originalname: fileName,
      mimetype: mimeType,
      size: fileBuffer.length,
    };

    try {
      const kindLabel = link.defaultKind === 'petty_cash' ? 'تنخواه‌گردان' : 'فاکتور خرید';
      const userText = msg.caption ? `${msg.caption} [${kindLabel}]` : `[${kindLabel}]`;

      const doc = await this.captureService.create(link.tenantId, link.userId, uploadedFile, {
        kind: captureKindFor(link.defaultKind),
        text: userText,
      });

      await this.sendTelegramMessage(
        chatId,
        `✅ رسید شما با موفقیت دریافت شد و پیش‌نویس آن در رکسایرا ثبت گردید.\n\n` +
          `• نوع سند: ${kindLabel}\n` +
          `• شناسه پیگیری: ${doc.id}\n\n` +
          `لطفاً برای بررسی و تأیید نهایی سند، به بخش «ثبت خودکار فاکتور» در پنل رکسایرا مراجعه فرمایید.`,
      );
      return { status: 'captured', message: doc.id };
    } catch (err) {
      this.logger.error(`Failed to process capture: ${(err as Error).message}`);
      await this.sendTelegramMessage(
        chatId,
        `❌ پردازش رسید با خطا مواجه شد: ${(err as Error).message}`,
      );
      return { status: 'capture_failed' };
    }
  }

  // ---------------------------------------------------------------------------
  // Telegram Bot API client calls
  // ---------------------------------------------------------------------------

  async sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
    const token = this.botToken();
    if (!token) {
      this.logger.warn('RECEIPT_BOT_TOKEN is not set; skipping message send');
      return false;
    }

    const url = `${this.botApiBase()}/bot${token}/sendMessage`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4000),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch (err) {
      this.logger.warn(`Failed to send Telegram message to ${chatId}: ${(err as Error).message}`);
      return false;
    }
  }

  async downloadTelegramFile(fileId: string): Promise<Buffer> {
    const token = this.botToken();
    if (!token) {
      throw new BadRequestException('ربات تلگرام در تنظیمات سرور پیکربندی نشده است.');
    }

    // 1. getFile
    const getFileUrl = `${this.botApiBase()}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const getFileRes = await this.fetchFn(getFileUrl, { signal: AbortSignal.timeout(10000) });
    if (!getFileRes.ok) {
      throw new BadRequestException(`دریافت اطلاعات فایل از تلگرام ناموفق بود (${getFileRes.status})`);
    }
    const fileInfo = (await getFileRes.json()) as { ok: boolean; result?: { file_path?: string } };
    const filePath = fileInfo.result?.file_path;
    if (!filePath) {
      throw new BadRequestException('مسیر فایل از تلگرام دریافت نشد.');
    }

    // 2. download file bytes
    const downloadUrl = `${this.botApiBase()}/file/bot${token}/${filePath}`;
    const fileRes = await this.fetchFn(downloadUrl, { signal: AbortSignal.timeout(30000) });
    if (!fileRes.ok) {
      throw new BadRequestException(`دانلود تصویر از تلگرام ناموفق بود (${fileRes.status})`);
    }
    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
