import { HttpException, Inject, Injectable } from '@nestjs/common';
import { requireModulePermission } from '../../access/access-context';
import { AccessAction } from '../../access/catalogue';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { ASSISTANT_TZ_OFFSET_MS } from '../constants/assistant.constants';
import { jalaliToday } from '../services/jalali-period';
import { METRIC_REGISTRY } from './metric-registry';
import { METRIC_SOURCES, MetricResult, MetricSources } from './metric.types';

export type MetricOutcome =
  | { ok: true; result: MetricResult }
  | { ok: false; error: string };

/**
 * اجرای متریک‌های تأییدشده برای مستأجر کاربر. شناسهٔ مستأجر فقط از JWT می‌آید
 * و هیچ ورودی مستأجر/SQL پذیرفته نمی‌شود؛ متریک‌ها فقط می‌خوانند.
 */
@Injectable()
export class AssistantMetricsService {
  constructor(@Inject(METRIC_SOURCES) private readonly sources: MetricSources) {}

  /** فقط متریک‌هایی که کاربر اجازهٔ خواندنشان را دارد. */
  list(
    request: AuthenticatedRequest,
  ): Array<{ id: string; labelFa: string; unit: string; definitionFa: string }> {
    requireTenantId(request);
    const readable = METRIC_REGISTRY.filter((metric) => {
      try {
        requireModulePermission(request, metric.module, AccessAction.READ);
        return true;
      } catch {
        return false;
      }
    });
    return readable.map(({ id, labelFa, unit, definitionFa }) => ({
      id,
      labelFa,
      unit,
      definitionFa,
    }));
  }

  has(id: string): boolean {
    return METRIC_REGISTRY.some((metric) => metric.id === id);
  }

  async run(
    request: AuthenticatedRequest,
    id: string,
    now: Date = new Date(),
  ): Promise<MetricOutcome> {
    const tenantId = requireTenantId(request);
    const metric = METRIC_REGISTRY.find((entry) => entry.id === id);
    if (!metric) {
      return { ok: false, error: `متریک ناشناخته: ${id}` };
    }
    try {
      requireModulePermission(request, metric.module, AccessAction.READ);
      const today = new Date(now.getTime() + ASSISTANT_TZ_OFFSET_MS)
        .toISOString()
        .slice(0, 10);
      const computed = await metric.compute({
        tenantId,
        now,
        today,
        jalali: jalaliToday(now),
        sources: this.sources,
      });
      return {
        ok: true,
        result: {
          id: metric.id,
          labelFa: metric.labelFa,
          unit: metric.unit,
          value: computed.value,
          ...('reasonFa' in computed ? { reasonFa: computed.reasonFa } : {}),
          asOf: today,
          definitionFa: metric.definitionFa,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        return { ok: false, error: error.message };
      }
      // خطای منبع داده نباید به یک عدد حدسی یا خطای ۵۰۰ تبدیل شود: دستیار پرهیز می‌کند.
      return { ok: false, error: 'محاسبهٔ این شاخص اکنون ممکن نیست.' };
    }
  }
}
