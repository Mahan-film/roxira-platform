import Link from "next/link";
import { ArrowLeft, BookOpen, Calculator, ReceiptText, Sparkles } from "lucide-react";

import { DamagesCalculator } from "@/components/damages/damages-calculator";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PORTAL_CARDS = [
  {
    href: "#damages-calculator",
    title: "محاسبه‌گر خسارت تاخیر تادیه",
    description:
      "محاسبه دقیق خسارت بر اساس شاخص بانک مرکزی (ماده ۵۲۲ ق.آ.د.م) یا نرخ سود سالانه قراردادی.",
    icon: Calculator,
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  {
    href: "/invoicing",
    title: "سامانه فاکتورها",
    description:
      "صدور صورتحساب مالیاتی با محاسبه آنی مالیات ۹٪ و مدیریت سوابق فاکتورهای سازمانی.",
    icon: ReceiptText,
    accent: "text-sky-600 dark:text-sky-400",
  },
  {
    href: "/docs",
    title: "مستندات API",
    description:
      "مستندات رسمی سرویس‌های سازمانی برای یکپارچه‌سازی سامانه‌های شما با پورتال روکسیرا.",
    icon: BookOpen,
    accent: "text-violet-600 dark:text-violet-400",
    external: true,
  },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6">
        <section className="space-y-3 text-center">
          <Badge variant="outline" className="mx-auto">
            <Sparkles className="size-3" />
            پورتال خدمات سازمانی روکسیرا
          </Badge>
          <h1 className="text-3xl font-extrabold tracking-tight">
            خدمات مالی و قضایی سازمانی
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
            دسترسی یکپارچه به محاسبه خسارت تاخیر تادیه، صدور فاکتورهای سازمانی و مستندات رسمی
            سرویس‌های روکسیرا.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {PORTAL_CARDS.map(({ href, title, description, icon: Icon, accent, external }) => {
            const body = (
              <Card className="h-full transition-all group-hover:-translate-y-1 group-hover:border-primary/40 group-hover:shadow-lg">
                <CardHeader>
                  <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
                    <Icon className={`size-6 ${accent}`} />
                  </span>
                  <CardTitle className="mt-2 text-lg">{title}</CardTitle>
                  <CardDescription className="leading-relaxed">{description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                    ورود به سامانه
                    <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
                  </span>
                </CardContent>
              </Card>
            );

            return external ? (
              <a key={href} href={href} className="group">
                {body}
              </a>
            ) : (
              <Link key={href} href={href} className="group">
                {body}
              </Link>
            );
          })}
        </section>

        <section id="damages-calculator" className="scroll-mt-20 space-y-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold tracking-tight">محاسبه سریع خسارت تاخیر تادیه</h2>
            <p className="text-sm text-muted-foreground">
              دسترسی مستقیم به موتور محاسبات قضایی بدون خروج از داشبورد.
            </p>
          </div>
          <DamagesCalculator />
        </section>
      </main>
    </div>
  );
}
