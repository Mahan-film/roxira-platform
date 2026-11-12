import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MailService } from '../../auth/services/mail.service';
import {
  DEFAULT_INQUIRY_SOURCE,
  INQUIRY_EMAIL_REGEX,
  INQUIRY_PHONE_REGEX,
  LEAD_NOTIFY_EMAIL_ENV,
  MY_LEGAL_WAITLIST_SOURCE,
  UPGRADE_INQUIRY_SOURCE_PREFIX,
} from '../constants/inquiries.constants';
import { CreateInquiryDto } from '../dto/create-inquiry.dto';
import {
  InquiryResponseDto,
  PaginatedInquiriesResponseDto,
} from '../dto/inquiry-response.dto';
import { QueryInquiryDto } from '../dto/query-inquiry.dto';
import { EnterpriseInquiryEntity } from '../entities/enterprise-inquiry.entity';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { InquiriesRepository } from '../repositories/inquiries.repository';

/**
 * سرویس پیش‌ثبت‌نام و درخواست همکاری سازمانی.
 *
 * تمام منطق کسب‌وکار (پاک‌سازی/اعتبارسنجی ورودی، ثبت درخواست به‌عنوان
 * درخواست عمومی با `tenant_id = NULL` و اطلاع‌رسانی به فروش) اینجا متمرکز
 * است؛ Controller فقط مسیریابی HTTP می‌کند و Repository تنها لایه دسترسی به
 * پایگاه‌داده است (Rule #3 - AGENTS.md).
 */
@Injectable()
export class InquiriesService {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(
    private readonly inquiriesRepository: InquiriesRepository,
    private readonly mail: MailService,
  ) {}

  private toResponse(
    inquiry: EnterpriseInquiryEntity,
  ): InquiryResponseDto {
    return {
      id: inquiry.id,
      tenantId: inquiry.tenantId,
      name: inquiry.name,
      company: inquiry.company,
      phone: inquiry.phone,
      email: inquiry.email,
      message: inquiry.message,
      source: inquiry.source,
      status: inquiry.status,
      createdAt: inquiry.createdAt,
    };
  }

  async create(dto: CreateInquiryDto): Promise<InquiryResponseDto> {
    const name = dto.name.trim();
    const phone = dto.phone.trim();
    const email = dto.email?.trim().toLowerCase() || null;

    if (name.length < 2) {
      throw new BadRequestException('نام تماس معتبر نیست.');
    }
    if (!INQUIRY_PHONE_REGEX.test(phone)) {
      throw new BadRequestException('شماره تماس معتبر نیست.');
    }
    if (email && !INQUIRY_EMAIL_REGEX.test(email)) {
      throw new BadRequestException('رایانامه معتبر نیست.');
    }

    const source = dto.source?.trim() || DEFAULT_INQUIRY_SOURCE;
    const consentRequired = source === MY_LEGAL_WAITLIST_SOURCE;
    if (consentRequired && (dto.consent !== true || !dto.consentVersion)) {
      throw new BadRequestException('رضایت صریح برای ثبت‌نام لازم است.');
    }
    const createdAt = new Date();
    // No consent column yet: record it with the message so it is kept with the row.
    const consentLine =
      dto.consent === true && dto.consentVersion
        ? `[consent: ${dto.consentVersion} at ${createdAt.toISOString()}]`
        : null;
    const message =
      [dto.message?.trim(), consentLine].filter(Boolean).join('\n') || null;

    const created = await this.inquiriesRepository.create({
      tenantId: null,
      name,
      company: dto.company?.trim() || null,
      phone,
      email,
      message,
      source,
      status: InquiryStatus.NEW,
      createdAt,
    });

    this.notifySales(created);
    return this.toResponse(created);
  }

  async list(
    query: QueryInquiryDto,
    operatorUserId?: string,
  ): Promise<PaginatedInquiriesResponseDto> {
    const [entities, total] = await this.inquiriesRepository.findAndCount({
      status: query.status,
      search: query.search?.trim() || undefined,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      ...(operatorUserId ? { operatorUserId } : {}),
    });

    return {
      data: entities.map((entity) => this.toResponse(entity)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Mails the owner about a new lead. Not awaited, so a slow or broken mail
   * server never delays or fails the form; the row is already stored. Logs carry
   * the id and source only, never contact details.
   */
  private notifySales(inquiry: EnterpriseInquiryEntity): void {
    const recipient = process.env[LEAD_NOTIFY_EMAIL_ENV]?.trim();
    if (!recipient || !INQUIRY_EMAIL_REGEX.test(recipient)) {
      return;
    }
    if (inquiry.source?.startsWith(UPGRADE_INQUIRY_SOURCE_PREFIX)) {
      return;
    }
    const warn = () =>
      this.logger.warn(`lead notice not sent for inquiry #${inquiry.id} (source=${inquiry.source ?? '-'})`);
    this.mail
      .sendLeadNotice(recipient, inquiry)
      .then((sent) => {
        if (!sent) warn();
      })
      .catch(warn);
  }
}
