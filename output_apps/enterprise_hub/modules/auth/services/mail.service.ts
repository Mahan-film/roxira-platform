import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { UiLocale } from '../constants/password-auth.constants';

/**
 * Transactional email for auth (password reset). SMTP settings come from the
 * environment only: SMTP_HOST (default roxira_mail), SMTP_PORT (25),
 * SMTP_USER / SMTP_PASSWORD (optional), MAIL_FROM.
 * Sending is best-effort: callers never learn whether an address exists.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const user = this.config.get<string>('SMTP_USER', '');
      this.transporter = createTransport({
        host: this.config.get<string>('SMTP_HOST', 'roxira_mail'),
        port: Number(this.config.get<string>('SMTP_PORT', '25')),
        secure: this.config.get<string>('SMTP_SECURE', '') === 'true',
        auth: user
          ? { user, pass: this.config.get<string>('SMTP_PASSWORD', '') }
          : undefined,
        connectionTimeout: 8000,
        socketTimeout: 15000,
      });
    }
    return this.transporter;
  }

  /** Base URL of the portal the user signed up on; used to build the reset link. */
  portalUrl(locale: UiLocale): string {
    return locale === 'en'
      ? this.config.get<string>('PORTAL_URL_NET', 'https://roxira.net')
      : this.config.get<string>('PORTAL_URL_IR', 'https://roxira.ir');
  }

  async sendPasswordReset(
    to: string,
    token: string,
    locale: UiLocale,
    ttlMinutes: number,
  ): Promise<boolean> {
    const link = `${this.portalUrl(locale)}/account/reset-password?token=${encodeURIComponent(token)}&lang=${locale}`;
    const en = locale === 'en';
    const subject = en ? 'Reset your Roxira password' : 'بازیابی رمز عبور روکسیرا';
    const text = en
      ? `Use this link to choose a new password (valid for ${ttlMinutes} minutes):\n\n${link}\n\nIf you did not ask for this, ignore this email; your password stays the same.`
      : `برای انتخاب رمز عبور جدید از این پیوند استفاده کنید (اعتبار: ${ttlMinutes} دقیقه):\n\n${link}\n\nاگر این درخواست از شما نبوده است، این ایمیل را نادیده بگیرید.`;
    try {
      await this.getTransporter().sendMail({
        from: this.config.get<string>('MAIL_FROM', 'Roxira <info@roxira.net>'),
        to,
        subject,
        text,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `[MAIL] password reset email failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** Invitation to join an organisation. Best effort, like every transactional mail here. */
  async sendInvitation(to: string, link: string, orgName: string, locale: UiLocale): Promise<boolean> {
    return this.send(
      to,
      locale === 'en' ? `You are invited to ${orgName} on Roxira` : `دعوت به ${orgName} در روکسیرا`,
      locale === 'en'
        ? `You have been invited to join ${orgName}.\n\nOpen this link to accept (valid for 7 days):\n\n${link}\n\nIf you were not expecting this, ignore this email.`
        : `شما به سازمان ${orgName} دعوت شده‌اید.\n\nبرای پذیرش از این پیوند استفاده کنید (اعتبار: ۷ روز):\n\n${link}\n\nاگر انتظار این دعوت را نداشتید، این ایمیل را نادیده بگیرید.`,
    );
  }

  /** Security notice, e.g. sign-in from a new device. */
  async sendSecurityAlert(to: string, subject: string, text: string): Promise<boolean> {
    return this.send(to, subject, text);
  }

  private async send(to: string, subject: string, text: string): Promise<boolean> {
    try {
      await this.getTransporter().sendMail({
        from: this.config.get<string>('MAIL_FROM', 'Roxira <info@roxira.net>'),
        to,
        subject,
        text,
      });
      return true;
    } catch (error) {
      this.logger.warn(`[MAIL] send failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
