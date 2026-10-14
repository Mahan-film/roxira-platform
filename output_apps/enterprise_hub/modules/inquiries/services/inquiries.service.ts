import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_INQUIRY_SOURCE,
  INQUIRY_EMAIL_REGEX,
  INQUIRY_PHONE_REGEX,
  SALES_NOTIFY_EMAIL_ENV,
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

  constructor(private readonly inquiriesRepository: InquiriesRepository) {}

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
    const email = dto.email.trim().toLowerCase();

    if (name.length < 2) {
      throw new BadRequestException('نام تماس معتبر نیست.');
    }
    if (!INQUIRY_PHONE_REGEX.test(phone)) {
      throw new BadRequestException('شماره تماس معتبر نیست.');
    }
    if (!INQUIRY_EMAIL_REGEX.test(email)) {
      throw new BadRequestException('رایانامه معتبر نیست.');
    }

    const created = await this.inquiriesRepository.create({
      tenantId: null,
      name,
      company: dto.company?.trim() || null,
      phone,
      email,
      message: dto.message?.trim() || null,
      source: dto.source?.trim() || DEFAULT_INQUIRY_SOURCE,
      status: InquiryStatus.NEW,
      createdAt: new Date(),
    });

    this.notifySales(created);
    return this.toResponse(created);
  }

  async list(
    query: QueryInquiryDto,
  ): Promise<PaginatedInquiriesResponseDto> {
    const [entities, total] = await this.inquiriesRepository.findAndCount({
      status: query.status,
      search: query.search?.trim() || undefined,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: entities.map((entity) => this.toResponse(entity)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * اطلاع‌رسانی به فروش. در بک‌اند NestJS هیچ helper ارسال ایمیل موجود نیست،
   * بنابراین فقط یک لاگ ثبت می‌شود (بدون ارسال واقعی)؛ به‌محض افزودن سرویس
   * ایمیل، همین نقطه به آن متصل می‌شود.
   */
  private notifySales(inquiry: EnterpriseInquiryEntity): void {
    const recipient = process.env[SALES_NOTIFY_EMAIL_ENV]?.trim();
    if (!recipient) {
      return;
    }
    // No PII in logs: id and source only; details are in the admin list.
    this.logger.log(`new enterprise inquiry #${inquiry.id} (source=${inquiry.source ?? '-'}) notify=${recipient}`);
  }
}
