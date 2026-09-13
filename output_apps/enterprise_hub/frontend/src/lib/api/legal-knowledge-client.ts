/**
 * کلاینت سمت سرور برای پایگاه دانش حقوقی (AI Core Layer — FastAPI/Python).
 *
 * صفحات داینامیک `laws/[slug]` و `precedents/[slug]` به‌صورت React Server
 * Component رندر می‌شوند؛ بنابراین فراخوانی باید از سمت سرور و با آدرس
 * مطلق سرویس FastAPI (`JUDGE_API_ORIGIN`) انجام شود، نه مسیر نسبی پروکسی
 * مرورگر. این فایل صرفاً در Server Components / Route Handlers استفاده
 * می‌شود و هرگز به باندل مرورگر وارد نمی‌شود.
 *
 * قرارداد اندپوینت‌ها (Contract-First) منطبق بر `smartjudge_module.py` است:
 *   • GET /api/v1/apps/judge/knowledge       → فهرست گره‌ها (LAW / PRECEDENT)
 *   • GET /api/v1/apps/judge/knowledge/{slug} → یک گره کامل بر اساس اسلاگ سئو
 */

/** آدرس واقعی موتور قاضی هوشمند؛ در production از env تزریق می‌شود. */
const JUDGE_API_ORIGIN = process.env.JUDGE_API_ORIGIN ?? "http://localhost:8000";

/** مسیر کامل و نسخه‌بندی‌شده پایگاه دانش حقوقی. */
const KNOWLEDGE_ENDPOINT = `${JUDGE_API_ORIGIN}/api/v1/apps/judge/knowledge`;

/** مدت اعتبار کش (ISR) محتوای حقوقی — محتوای قانونی به‌ندرت تغییر می‌کند. */
const KNOWLEDGE_REVALIDATE_SECONDS = 86_400;

/** نوع گره پایگاه دانش. */
export type LegalNodeType = "LAW" | "PRECEDENT";

/** فراداده ساختاریافته یک گره حقوقی (شماره ماده، اعتبار، مرجع و ...). */
export type LegalNodeMetadata = Record<string, unknown>;

/** یک ماده قانونی یا رأی وحدت رویه در پایگاه دانش GraphRAG. */
export interface LegalNode {
  node_id: string;
  node_type: string;
  title: string;
  category: string | null;
  content: string;
  metadata: LegalNodeMetadata;
  created_at: string | null;
}

/** خلاصه یک گره برای فهرست‌ها و تولید مسیرهای استاتیک. */
export interface LegalNodeSummary {
  slug: string;
  node_id: string;
  node_type: string;
  title: string;
  category: string | null;
}

/**
 * استخراج اسلاگ سئو از `node_id` — دقیقاً هم‌راستا با
 * `generate_seo_sitemaps.py` (حروف کوچک و تبدیل `_` به `-`).
 */
export function nodeIdToSlug(nodeId: string): string {
  return nodeId.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * نرمال‌سازی اسلاگ مسیر.
 *
 * پارامترهای مسیر Next.js ممکن است برای اسلاگ‌های غیرلاتین (فارسی) به‌صورت
 * percent-encoded تحویل داده شوند؛ این تابع با یک بار decode امن، از
 * دوباره‌انکود شدن (Double Encoding) جلوگیری می‌کند.
 */
function decodeSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed).toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * واکشی یک گره حقوقی بر اساس اسلاگ.
 *
 * در صورت عدم وجود سند (۴۰۴) یا عدم دسترسی به بک‌اند، مقدار `null`
 * برگردانده می‌شود تا صفحه بتواند `notFound()` را فراخوانی کند و هرگز در
 * زمان build با خطای اتصال شبکه شکست نخورد.
 */
export async function getLegalNode(slug: string): Promise<LegalNode | null> {
  const normalized = decodeSlug(slug);
  if (!normalized) return null;

  try {
    const response = await fetch(
      `${KNOWLEDGE_ENDPOINT}/${encodeURIComponent(normalized)}`,
      { next: { revalidate: KNOWLEDGE_REVALIDATE_SECONDS } },
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as { node?: LegalNode };
    return payload.node ?? null;
  } catch {
    return null;
  }
}

/** واکشی ماده قانونی (`LAW`) بر اساس اسلاگ. */
export async function getLawBySlug(slug: string): Promise<LegalNode | null> {
  const node = await getLegalNode(slug);
  if (!node) return null;
  return node.node_type === "LAW" ? node : null;
}

/** واکشی رأی وحدت رویه (`PRECEDENT`) بر اساس اسلاگ. */
export async function getPrecedentBySlug(slug: string): Promise<LegalNode | null> {
  const node = await getLegalNode(slug);
  if (!node) return null;
  return node.node_type === "PRECEDENT" ? node : null;
}

/**
 * فهرست گره‌های فعال یک نوع مشخص (برای صفحه‌های ایندکس و تولید لینک
 * داخلی). در صورت خطا آرایه خالی برمی‌گردد.
 */
export async function listLegalNodes(
  nodeType: LegalNodeType,
  limit = 200,
): Promise<LegalNodeSummary[]> {
  try {
    const response = await fetch(
      `${KNOWLEDGE_ENDPOINT}?node_type=${nodeType}&limit=${limit}`,
      { next: { revalidate: KNOWLEDGE_REVALIDATE_SECONDS } },
    );

    if (!response.ok) return [];

    const payload = (await response.json()) as { nodes?: LegalNodeSummary[] };
    return payload.nodes ?? [];
  } catch {
    return [];
  }
}
