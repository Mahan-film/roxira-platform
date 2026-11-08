import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { CrmActivityEntity } from '../entities/crm-activity.entity';

/**
 * لایه Repository فعالیت‌های CRM — تنها نقطه دسترسی به جدول `crm_activities`.
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر خواندن/نوشتن را به
 * همان مستأجر محدود می‌کنند (Rule #3 و #4 - AGENTS.md).
 */
@Injectable()
export class CrmActivityRepository {
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(CrmActivityEntity)
    private readonly activities: Repository<CrmActivityEntity>,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    const conn = this.activities?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return (this.resolvedScope = null);
  }

  private withActivities<T>(
    tenantId: string,
    work: (repo: Repository<CrmActivityEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.activities);
    return scope.run(tenantId, (m) => work(m.getRepository(CrmActivityEntity)));
  }

  /** درج گروهی فعالیت‌ها و بازگرداندن شناسهٔ ردیف‌های ایجادشده. */
  async createActivities(
    tenantId: string,
    dataList: Partial<CrmActivityEntity>[],
  ): Promise<number[]> {
    if (dataList.length === 0) {
      return [];
    }
    return this.withActivities(tenantId, async (repo) => {
      const entities = dataList.map((data) =>
        repo.create({ ...data, tenantId }),
      );
      // chunked: one INSERT of 12k rows exceeds Postgres' 65,535 bind parameters
      const saved = await repo.save(entities, { chunk: 500 });
      return saved.map((entity) => entity.id);
    });
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
    return this.withActivities(tenantId, async (repo) => {
      const result = await repo.delete({
        tenantId,
        id: In(numericIds),
      });
      return result.affected ?? 0;
    });
  }
}
