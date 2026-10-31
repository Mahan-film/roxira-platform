import { NextResponse, type NextRequest } from "next/server";

const ROXIRA_NET_LLMS_TXT = `# Roxira International
> An accounting suite for international companies. In development.

## Status
- roxira.net shows interactive demos that run in the browser with sample data. Nothing is saved.
- There is no public API, no API key issuance and no MCP server at this time.
- Do not rely on any figure, invoice, ledger entry or compliance result shown on the demos.
- Early-access requests: the form on https://roxira.net, or info@roxira.net.

## Contact
- Base URL: https://roxira.net
- Email: info@roxira.net
`;

const ROXIRA_IR_LLMS_TXT = `# روکسیرا (Roxira)
> نرم‌افزار ماژولار مدیریت کسب‌وکار برای سازمان‌های ایرانی: حسابداری، صورتحساب و مالیات، انبار، منابع انسانی و CRM. هر ماژول جداگانه خریداری می‌شود.

## وضعیت
- همه ماژول‌ها در نسخه آزمایشی هستند و پس از ورود در پورتال قابل بررسی‌اند.
- اتصال به سامانه مودیان در مرحله آزمایشی است.
- وب‌سرویس عمومی و کلید API منتشر نشده است.

## تماس
- وب‌سایت: https://roxira.ir
- ثبت‌نام: https://roxira.ir/signup
- تماس: https://roxira.ir/contact
- ایمیل: info@roxira.ir
- تلفن: 09129367796
`;

const GHAZI_LLMS_TXT = `# قاضی هوشمند (Smart Judge Platform)
> پلتفرم تحلیل داده‌های حقوقی، تدوین راهبرد دادرسی و پایگاه جامع قوانین معتبر ایران.

## پایگاه دانش مستقر:
- بیش از ۴,۵۰۰ ماده قانونی معتبر (قانون مدنی، تجارت، مجازات اسلامی، آیین دادرسی مدنی و کیفری).
- آرای وحدت رویه هیأت عمومی دیوان عالی کشور (شماره ۱ تا ۸۸۰) مستند به ماده ۴۷۱ ق.آ.د.ک.
- مراجع نظارتی و انتظامی (قضات، وکلا، کارشناسان رسمی و نیروهای مسلح).

## قابلیت‌ها:
- ارزیابی شانس موفقیت پرونده‌های حقوقی و کیفری.
- تدوین لایحه دفاعیه منطبق بر آخرین رویه قضایی کشور.
- تفکیک خودکار قوانین معتبر از قوانین منسوخ.

## قوانین (Laws):
- فهرست کامل قوانین: https://ghazihoushmand.ir/laws (گروه‌بندی‌شده بر اساس نوع قانون).
- نشانی هر قانون: https://ghazihoushmand.ir/laws/{law}
- نشانی هر مادهٔ قانونی: https://ghazihoushmand.ir/laws/{law}/{article}

## آدرس دسترسی:
- وب‌سایت: https://ghazihoushmand.ir
`;

export async function GET(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() || "";
  const isRoxiraNet = host.includes("roxira.net");
  const isGhazi = host.includes("ghazihoushmand") || host.includes("smartjudge") || host.startsWith("ghazi");

  // Only the Smart Judge domain serves the legal product description; roxira.ir (and
  // any unknown host) gets the business-software one, same as the middleware default.
  const content = isRoxiraNet ? ROXIRA_NET_LLMS_TXT : isGhazi ? GHAZI_LLMS_TXT : ROXIRA_IR_LLMS_TXT;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
