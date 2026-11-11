import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnterpriseInquiryEntity } from '../entities/enterprise-inquiry.entity';

/**
 * لایه Repository — تنها نقطه دسترسی به جدول `enterprise_inquiries`.
 *
 * تمام کوئری‌ها/ذخیره‌ها از این لایه عبور می‌کنند تا Service هیچ دسترسی
 * مستقیمی به پایگاه‌داده نداشته باشد (Rule #3 - AGENTS.md). ستون مالکیت
 * `tenant_id` صریحاً در ورودی ذخیره می‌شود و برای درخواست عمومی NULL است
 * (Rule #4 - AGENTS.md).
 */
@Injectable()
export class InquiriesRepository {
  private readonly logger = new Logger(InquiriesRepository.name);

  constructor(
    @InjectRepository(EnterpriseInquiryEntity)
    private readonly inquiries: Repository<EnterpriseInquiryEntity>,
  ) {}

  async create(
    data: Partial<EnterpriseInquiryEntity>,
  ): Promise<EnterpriseInquiryEntity> {
    try {
      const rows = await this.inquiries.query(
        `SELECT public.submit_enterprise_inquiry($1, $2, $3, $4, $5, $6, $7) AS id`,
        [
          data.name ?? '',
          data.company ?? null,
          data.phone ?? null,
          data.email ?? null,
          data.message ?? null,
          data.source ?? null,
          data.tenantId ?? null,
        ],
      );
      if (rows && rows.length > 0) {
        return this.inquiries.create({
          ...data,
          id: Number(rows[0].id),
          createdAt: new Date(),
        } as EnterpriseInquiryEntity);
      }
      throw new Error('submit_enterprise_inquiry returned no id');
    } catch (err) {
      this.logger.error(`submit_enterprise_inquiry error: ${err}`);
      throw err;
    }
  }

  async findAndCount(options: {
    status?: string;
    search?: string;
    skip: number;
    take: number;
  }): Promise<[EnterpriseInquiryEntity[], number]> {
    const query = this.inquiries.createQueryBuilder('inquiry');

    if (options.status) {
      query.andWhere('inquiry.status = :status', { status: options.status });
    }
    if (options.search) {
      const pattern = `%${options.search}%`;
      query.andWhere(
        '(inquiry.name ILIKE :pattern OR inquiry.company ILIKE :pattern OR inquiry.email ILIKE :pattern OR inquiry.phone ILIKE :pattern)',
        { pattern },
      );
    }

    query
      .orderBy('inquiry.createdAt', 'DESC')
      .addOrderBy('inquiry.id', 'DESC')
      .skip(options.skip)
      .take(options.take);

    return query.getManyAndCount();
  }
}
