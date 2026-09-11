/**
 * شمارشی‌ها و ثابت‌های معنایی ماژول CRM و پایپ‌لاین سرنخ‌ها.
 */

/**
 * مراحل چرخه عمر فروش یک سرنخ (Lead) در پایپ‌لاین سازمانی.
 *
 * NEW:       سرنخ تازه ثبت‌شده و هنوز تماس گرفته نشده.
 * CONTACTED: تماس اولیه برقرار شده است.
 * QUALIFIED: سرنخ واجد شرایط فروش تشخیص داده شده است.
 * PROPOSAL:  پیشنهاد قیمت/قرارداد ارسال شده است.
 * WON:       معامله برنده شده (تبدیل به مشتری).
 * LOST:      معامله از دست رفته است.
 */
export enum PipelineStage {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  PROPOSAL = 'PROPOSAL',
  WON = 'WON',
  LOST = 'LOST',
}

/**
 * مراحل «باز» پایپ‌لاین که هنوز به نتیجه قطعی (برد/باخت) نرسیده‌اند و ارزش
 * ریالی آن‌ها به‌عنوان فرصت باز محاسبه می‌شود.
 */
export const OPEN_PIPELINE_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.NEW,
  PipelineStage.CONTACTED,
  PipelineStage.QUALIFIED,
  PipelineStage.PROPOSAL,
]);

/**
 * ترتیب نمایش مراحل پایپ‌لاین در تابلوی کانبان و گزارش‌های تحلیلی.
 */
export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = [
  PipelineStage.NEW,
  PipelineStage.CONTACTED,
  PipelineStage.QUALIFIED,
  PipelineStage.PROPOSAL,
  PipelineStage.WON,
  PipelineStage.LOST,
];

/** برچسب فارسی مراحل پایپ‌لاین برای گزارش‌ها و UI. */
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  [PipelineStage.NEW]: 'سرنخ جدید',
  [PipelineStage.CONTACTED]: 'تماس گرفته‌شده',
  [PipelineStage.QUALIFIED]: 'واجد شرایط',
  [PipelineStage.PROPOSAL]: 'ارسال پیشنهاد',
  [PipelineStage.WON]: 'برنده‌شده',
  [PipelineStage.LOST]: 'از دست رفته',
};

/**
 * کانال برقراری تماس با سرنخ که در جدول `contact_messages` به‌عنوان
 * `channel` ذخیره می‌شود.
 */
export enum ContactChannel {
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  MEETING = 'MEETING',
  SMS = 'SMS',
  OTHER = 'OTHER',
}

/** برچسب فارسی کانال‌های تماس. */
export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  [ContactChannel.PHONE]: 'تماس تلفنی',
  [ContactChannel.EMAIL]: 'رایانامه',
  [ContactChannel.MEETING]: 'جلسه',
  [ContactChannel.SMS]: 'پیامک',
  [ContactChannel.OTHER]: 'سایر',
};
