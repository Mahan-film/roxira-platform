import { NextResponse, type NextRequest } from "next/server";

/**
 * تفکیک دامنه‌ای لایه UI/UX:
 *
 *   • ghazihoushmand.ir  → سامانه قاضی هوشمند (تجربه چت‌محور در ریشه)
 *   • roxira.ir / roxira.net / IP → پورتال خدمات سازمانی روکسیرا
 *
 * یک اپلیکیشن Next.js مشترک، بر اساس Hostname دو تجربه کاملاً مجزا ارائه
 * می‌دهد؛ مسیر ریشه دامنه قاضی به صفحه چت بازنویسی (rewrite) می‌شود و
 * مسیرهای اختصاصی هر دامنه از دامنه مقابل به مقصد صحیح هدایت می‌گردند.
 */

const GHAZI_HOSTS = ["ghazihoushmand.ir", "www.ghazihoushmand.ir"];
const ROXIRA_HOSTS = [
  "roxira.ir",
  "www.roxira.ir",
  "roxira.net",
  "www.roxira.net",
];

function normalizeHost(host: string): string {
  return host.split(":")[0].trim().toLowerCase();
}

function isGhaziHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  if (GHAZI_HOSTS.includes(h)) return true;
  if (ROXIRA_HOSTS.includes(h)) return false;
  return h.includes("ghazihoushmand") || h.includes("smartjudge") || h.startsWith("ghazi");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ghazi = isGhaziHost(request.headers.get("host") ?? "");

  if (ghazi) {
    // مسیرهای پورتال سازمانی در دامنه قاضی معنا ندارند
    if (pathname.startsWith("/invoicing") || pathname.startsWith("/damages")) {
      return NextResponse.redirect(new URL("https://roxira.ir/"));
    }
    // ریشه دامنه قاضی = رابط چت هوشمند حقوقی
    if (pathname === "/" || pathname === "/judge") {
      const url = request.nextUrl.clone();
      url.pathname = "/chat";
      return NextResponse.rewrite(url);
    }
  } else if (pathname === "/chat" || pathname === "/judge") {
    // قاضی هوشمند فقط روی دامنه اختصاصی خودش سرو می‌شود
    return NextResponse.redirect(new URL("https://ghazihoushmand.ir/"));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/chat", "/judge", "/damages", "/invoicing"],
};
