import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CrmActivityEntity } from '../entities/crm-activity.entity';

/**
 * لایه Repository فعالیت‌های CRM — تنها نقطه دسترسی به جدول `crm_activities`.
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر خواندن/نوشتن را به
 * همان مستأجر محدود می‌کنند (Rule #3 و #4 - AGENTS.md).
 */
@Injectable()
export class CrmActivityRepository {
  constructor(
    @InjectRepository(CrmActivityEntity)
    private readonly activities: Repository<CrmActivityEntity>,
  ) {}

  /** درج گروهی فعالیت‌ها و بازگرداندن شناسهٔ ردیف‌های ایجادشده. */
  async createActivities(
    tenantId: string,
    dataList: Partial<CrmActivityEntity>[],
  ): Promise<number[]> {
    if (dataList.length === 0) {
      return [];
    }
    const entities = dataList.map((data) =>
      this.activities.create({ ...data, tenantId }),
    );
    const saved = await this.activities.save(entities);
    return saved.map((entity) => entity.id);
  }

  /** حذف فعالیت‌های یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteByIds(
    tenantId: string,
    ids: Array<number | string>,
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const numericIds = ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id));
    if (numericIds.length === 0) {
      return 0;
    }
    const result = await this.activities.delete({
      tenantId,
      id: In(numericIds),
    });
    return result.affected ?? 0;
  }
}
