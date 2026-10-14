import { Injectable } from '@nestjs/common';
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
  constructor(
    @InjectRepository(EnterpriseInquiryEntity)
    private readonly inquiries: Repository<EnterpriseInquiryEntity>,
  ) {}

  async create(
    data: Partial<EnterpriseInquiryEntity>,
  ): Promise<EnterpriseInquiryEntity> {
    const entity = this.inquiries.create(data);
    return this.inquiries.save(entity);
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
