import { NextResponse, type NextRequest } from "next/server";

/**
 * تفکیک دامنه‌ای لایه UI/UX:
 *
 *   • ghazihoushmand.ir  → سامانه قاضی هوشمند (تجربه چت‌محور در ریشه)
 *   • roxira.ir          → پورتال خدمات سازمانی روکسیرا (فارسی، RTL)
 *   • roxira.net         → Roxira International B2B Hub (انگلیسی، LTR)
 *
 * یک اپلیکیشن Next.js مشترک، بر اساس Hostname سه تجربه کاملاً مجزا ارائه
 * می‌دهد؛ ریشه دامنه قاضی به `/chat` و ریشه دامنه بین‌المللی به `/en`
 * بازنویسی (rewrite) می‌شود و مسیرهای اختصاصی هر دامنه از دامنه مقابل به
 * مقصد صحیح هدایت می‌گردند.
 */

const GHAZI_HOSTS = ["ghazihoushmand.ir", "www.ghazihoushmand.ir"];
const ROXIRA_IR_HOSTS = ["roxira.ir", "www.roxira.ir"];
const ROXIRA_NET_HOSTS = ["roxira.net", "www.roxira.net"];

/** دامنه‌های سازمانی که فقط روی roxira.ir معنا دارند. */
const ROXIRA_ONLY_PATHS = [
  "/invoicing",
  "/damages",
  "/accounting",
  "/inventory",
  "/crm",
  "/docs",
];

type ServiceDomain = "ghazi" | "roxira_ir" | "roxira_net";

function normalizeHost(host: string): string {
  return host.split(":")[0].trim().toLowerCase();
}

function resolveDomain(host: string): ServiceDomain {
  const h = normalizeHost(host);
  if (GHAZI_HOSTS.includes(h)) return "ghazi";
  if (ROXIRA_NET_HOSTS.includes(h)) return "roxira_net";
  if (ROXIRA_IR_HOSTS.includes(h)) return "roxira_ir";
  // IP/میزبان ناشناخته → پورتال فارسی سازمانی
  if (h.includes("ghazihoushmand") || h.includes("smartjudge") || h.startsWith("ghazi")) {
    return "ghazi";
  }
  if (h.includes("roxira.net")) return "roxira_net";
  return "roxira_ir";
}

function redirectGhazi(): NextResponse {
  return NextResponse.redirect(new URL("https://ghazihoushmand.ir/"));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const domain = resolveDomain(request.headers.get("host") ?? "");

  if (domain === "ghazi") {
    // مسیرهای پورتال سازمانی در دامنه قاضی معنا ندارند؛ به همان مسیر روی
    // roxira.ir هدایت می‌شویم (نه صرفاً ریشه) تا کاربر روی صفحه درخواستی
    // فرود بیاید، نه صفحه اصلی یک سایت دیگر.
    if (ROXIRA_ONLY_PATHS.some((path) => pathname.startsWith(path))) {
      return NextResponse.redirect(new URL(pathname + request.nextUrl.search, "https://roxira.ir"));
    }
    // ریشه دامنه قاضی = رابط چت هوشمند حقوقی
    if (pathname === "/" || pathname === "/judge") {
      const url = request.nextUrl.clone();
      url.pathname = "/chat";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // قاضی هوشمند فقط روی دامنه اختصاصی خودش سرو می‌شود
  if (pathname === "/chat" || pathname === "/judge" || pathname === "/draft-ruling" || pathname === "/draft-indictment") {
    return redirectGhazi();
  }

  if (domain === "roxira_net") {
    // ریشه دامنه بین‌المللی = پورتال انگلیسی B2B
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/en";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // roxira.ir و IP: پورتال فارسی سازمانی
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/en",
    "/chat",
    "/judge",
    "/draft-ruling",
    "/draft-indictment",
    "/damages",
    "/invoicing",
    "/accounting",
    "/inventory",
    "/crm",
    "/about",
    "/terms",
    "/privacy",
    "/services",
    "/technology",
    "/contact",
    "/docs",
  ],
};
