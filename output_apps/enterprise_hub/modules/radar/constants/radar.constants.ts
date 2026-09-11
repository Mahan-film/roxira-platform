/**
 * ثابت‌های ماژول رادار فناوری و ارکستراسیون ازدحام ایجنت‌ها.
 *
 * مسیر اسکریپت‌ها نسبت به ریشه پروژه (`RADAR_PROJECT_ROOT`) حل می‌شود؛ این
 * ریشه در docker-compose.prod.yml به‌صورت bind mount داخل کانتینر
 * roxira_enterprise_backend قرار گرفته است تا اجرای زنده اسکریپت‌های
 * پایتونی و خواندن گزارش‌ها ممکن باشد.
 */

/** ریشه پروژه روی میزبان که داخل کانتینر mount می‌شود. */
export const RADAR_PROJECT_ROOT_DEFAULT = '/opt/roxira_platform';

/** نام فایل گزارش مارک‌داون رسمی رادار فناوری. */
export const TECH_RADAR_REPORT_MD_FILENAME = 'TECH_RADAR_REPORT.md';

/** نام فایل گزارش ساختاریافته JSON رادار فناوری. */
export const TECH_RADAR_REPORT_JSON_FILENAME = 'TECH_RADAR_REPORT.json';

/** مسیر نسبی اسکریپت کاوشگر زنده فناوری. */
export const TECH_RADAR_SCRIPT = 'src/automation/tech_radar.py';

/** مسیر نسبی اسکریپت اجرای موازی ۱۰ ایجنت. */
export const SWARM_RUNNER_SCRIPT = 'src/automation/parallel_swarm_runner.py';

/** پیشوند خطوط ماشین‌خوان وضعیت زنده ایجنت‌ها در خروجی اسکریپت ازدحام. */
export const SWARM_STREAM_PREFIX = '@@SWARM@@';

/** پیشوند پیام پایان اجرای ازدحام. */
export const SWARM_DONE_PREFIX = '@@SWARM_DONE@@';

/** حداکثر تعداد خط لاگ نگه‌داری‌شده برای هر کار پس‌زمینه. */
export const MAX_JOB_LOG_LINES = 200;

/** تعریف ایستای ۱۰ ایجنت موازی برای نمایش اولیه در پنل فرماندهی. */
export interface SwarmAgentDefinition {
  id: string;
  label: string;
  task: string;
}

export const SWARM_AGENTS: SwarmAgentDefinition[] = [
  { id: 'agent-1-ai-audit', label: 'ممیزی موتورهای LLM', task: 'اتصال به درگاه OpenRouter و احراز کلید' },
  { id: 'agent-2-fe-lint', label: 'اعتبارسنجی فرانت‌اند', task: 'اجرای lint روی Next.js' },
  { id: 'agent-3-tech-radar', label: 'هوش تجاری وب', task: 'بررسی ارائه‌دهندگان جست‌وجوی عصبی' },
  { id: 'agent-4-db-check', label: 'پایش پایگاه داده', task: 'شمارش جدول کاربران' },
  { id: 'agent-5-redis-ping', label: 'پایش کش و صف', task: 'بررسی پاسخ Redis' },
  { id: 'agent-6-pgbouncer', label: 'استخر اتصالات', task: 'آزمون PgBouncer روی ۶۴۳۲' },
  { id: 'agent-7-accounting', label: 'دفاتر مالی', task: 'اعتبارسنجی کدینگ حساب‌ها' },
  { id: 'agent-8-inventory', label: 'انبار و FIFO', task: 'کنترل انبارها' },
  { id: 'agent-9-crm-leads', label: 'پایپ‌لاین فروش', task: 'پایش سرنخ‌های CRM' },
  { id: 'agent-10-qdrant', label: 'پایگاه برداری', task: 'بررسی سلامت کالکشن‌های Qdrant' },
];
