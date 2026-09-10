import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KAVENEGAR_BASE_URL,
  KAVENEGAR_TEMPLATE_GHAZI_DEFAULT,
  KAVENEGAR_TEMPLATE_ROXIRA_DEFAULT,
} from '../constants/auth.constants';
import { AuthServiceDomain } from '../enums/auth-service.enum';

interface KavenegarVerifyResponse {
  return?: {
    status?: number;
    message?: string;
  };
}

/**
 * سرویس اتصال به درگاه پیامکی کاوه‌نگار (Verify Lookup).
 *
 * انتخاب قالب بر اساس دامنه سرویس انجام می‌شود:
 *   • AuthServiceDomain.GHAZI  → قالب `ghazi-verify`
 *   • AuthServiceDomain.ROXIRA → قالب `roxira-verify`
 *
 * ارسال پیامک «Best-Effort» است: کد یک‌بارمصرف پیش از فراخوانی در Redis
 * ذخیره شده است؛ بنابراین خطای گذرا در درگاه پیامک باعث شکست کل فرایند
 * ورود نمی‌شود و صرفاً در لاگ‌ها هشدار ثبت می‌گردد.
 */
@Injectable()
export class KavenegarService {
  private readonly logger = new Logger(KavenegarService.name);
  private readonly apiKey: string;
  private readonly templateGhazi: string;
  private readonly templateRoxira: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('KAVENEGAR_API_KEY', '').trim();
    this.templateGhazi = this.config.get<string>(
      'KAVENEGAR_TEMPLATE_GHAZI',
      KAVENEGAR_TEMPLATE_GHAZI_DEFAULT,
    );
    this.templateRoxira = this.config.get<string>(
      'KAVENEGAR_TEMPLATE_ROXIRA',
      KAVENEGAR_TEMPLATE_ROXIRA_DEFAULT,
    );
  }

  /** آیا کلید درگاه کاوه‌نگار پیکربندی شده است. */
  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** نام قالب کاوه‌نگار متناسب با دامنه سرویس. */
  templateFor(domain: AuthServiceDomain): string {
    return domain === AuthServiceDomain.GHAZI
      ? this.templateGhazi
      : this.templateRoxira;
  }

  /**
   * ارسال کد یک‌بارمصرف با Verify Lookup کاوه‌نگار.
   * @returns true در صورت پذیرش ارسال از سوی درگاه، در غیر این صورت false.
   */
  async sendVerificationCode(
    phone: string,
    code: string,
    domain: AuthServiceDomain,
  ): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(
        '[KAVENEGAR] KAVENEGAR_API_KEY پیکربندی نشده است؛ ارسال پیامک انجام نشد.',
      );
      return false;
    }

    const template = this.templateFor(domain);
    const url = `${KAVENEGAR_BASE_URL}/${this.apiKey}/verify/lookup.json`;
    const params = new URLSearchParams({
      receptor: phone,
      token: code,
      template,
      type: 'sms',
    });

    try {
      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const body = (await response.json()) as KavenegarVerifyResponse;
      const status = body?.return?.status;

      if (!response.ok || (typeof status === 'number' && status !== 200)) {
        this.logger.warn(
          `[KAVENEGAR] ارسال ناموفق (HTTP ${response.status}): ${body?.return?.message ?? 'بدون پیام'}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.warn(
        `[KAVENEGAR] خطای ارتباط با درگاه پیامک: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
