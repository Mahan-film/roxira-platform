import { buildReview, PackageReview } from '../analysis/review';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ReconcileSelection,
  ReconciliationReport,
  reconcilePackage,
  selectionKey,
} from '../analysis/reconciliation';
import { EntityRegistryService } from '../registry/entity-registry.service';
import { PackageAnalysisService } from './package-analysis.service';
import { PackageStoreService } from './package-store.service';

/** سرویس مغایرت‌گیری: همان منطق ساخت ردیف را که commit دارد روی فایل اجرا می‌کند و گزارش می‌دهد. */
@Injectable()
export class PackageReconciliationService {
  constructor(
    private readonly store: PackageStoreService,
    private readonly analysisService: PackageAnalysisService,
    private readonly registry: EntityRegistryService,
  ) {}

  /** صفحهٔ بازبینی: گروه‌بندی و همهٔ سندهای پیشنهادی. برای بستهٔ OCR پیش‌شرط ثبت است. */
  async review(
    tenantId: string,
    packageId: string,
    selections: ReconcileSelection[],
    page: number,
  ): Promise<PackageReview & { ocr: boolean; key: string }> {
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new NotFoundException('این بسته یافت نشد یا منقضی شده است.');
    }
    if (!state.analysis || state.status !== 'ready') {
      throw new BadRequestException('این بسته آمادهٔ بازبینی نیست؛ ابتدا تحلیل باید کامل شود.');
    }
    const parsed = await this.analysisService.openPackage(state);
    try {
      const review = buildReview(parsed.tables, state.analysis, this.registry.all(), selections, page);
      const key = selectionKey(selections);
      const fresh = await this.store.getState(tenantId, packageId);
      if (fresh) {
        fresh.reviewedKey = key;
        await this.store.writeState(fresh);
      }
      return { ...review, ocr: Boolean(state.ocr), key };
    } finally {
      parsed.close();
    }
  }

  async reconcile(
    tenantId: string,
    packageId: string,
    selections: ReconcileSelection[],
  ): Promise<ReconciliationReport> {
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new NotFoundException('این بسته یافت نشد یا منقضی شده است.');
    }
    if (!state.analysis || (state.status !== 'ready' && state.status !== 'committing')) {
      throw new BadRequestException('این بسته آمادهٔ مغایرت‌گیری نیست؛ ابتدا تحلیل باید کامل شود.');
    }
    const key = selectionKey(selections);
    if (state.reconciliation?.key === key) {
      return state.reconciliation.report as ReconciliationReport;
    }
    const parsed = await this.analysisService.openPackage(state);
    try {
      const report = reconcilePackage(parsed.tables, state.analysis, this.registry.all(), selections);
      const fresh = await this.store.getState(tenantId, packageId);
      if (fresh) {
        fresh.reconciliation = { key, report };
        await this.store.writeState(fresh);
      }
      return report;
    } finally {
      parsed.close();
    }
  }
}
