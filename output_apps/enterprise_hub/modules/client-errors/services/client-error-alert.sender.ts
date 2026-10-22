import { Injectable, Logger } from '@nestjs/common';

/**
 * ارسال هشدار به کانال Telegram/Bale مالک با همان متغیرهای محیطی
 * `scripts/ops/notify/notify.py` (NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID / NOTIFY_BOT_API).
 * اگر تنظیم نشده باشند، بی‌صدا غیرفعال است و هرگز استثنا پرتاب نمی‌کند.
 */
@Injectable()
export class ClientErrorAlertSender {
  private readonly logger = new Logger(ClientErrorAlertSender.name);

  async send(text: string): Promise<boolean> {
    const token = process.env.NOTIFY_BOT_TOKEN;
    const chatId = process.env.NOTIFY_CHAT_ID;
    if (!token || !chatId) return false;
    const api = (process.env.NOTIFY_BOT_API || 'https://api.telegram.org').replace(/\/+$/, '');
    try {
      const res = await fetch(`${api}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4000),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      this.logger.warn('client-error alert delivery failed');
      return false;
    }
  }
}
