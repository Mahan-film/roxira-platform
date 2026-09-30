import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "پوشش قوانین | سامانه هوشمند قاضی هوشمند",
  description:
    "فهرست قوانین موجود در پایگاه قاضی هوشمند با تعداد مواد، مواد معتبر و تاریخ آخرین اصلاح یا تصویب، بر پایه اندازه‌گیری واقعی.",
};

type Law = {
  name: string;
  articles: number;
  active: number;
  inactive: number;
  newest_amended_on?: string | null;
  newest_approval_date?: string | null;
  is_bill?: boolean;
};

type Manifest = {
  totals: { laws: number; articles: number; active: number; inactive: number };
  laws: Law[];
};

const faNum = new Intl.NumberFormat("fa-IR");
const toFa = (v: string) => v.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

function loadManifest(): Manifest {
  const raw = readFileSync(join(process.cwd(), "public", "coverage_manifest.json"), "utf-8");
  return JSON.parse(raw) as Manifest;
}

export default function CoveragePage() {
  const { totals, laws } = loadManifest();

  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <section className="text-center space-y-3">
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight">پوشش قوانین</h1>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            آنچه در پایگاه ما واقعاً وجود دارد، بر پایه اندازه‌گیری از داده‌های بارگذاری‌شده.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div className="glass-surface rounded-2xl p-5 text-center">
            <div className="text-3xl font-bold text-amber-400">{faNum.format(totals.laws)}</div>
            <div className="text-xs text-muted-foreground mt-1">تعداد قوانین</div>
          </div>
          <div className="glass-surface rounded-2xl p-5 text-center">
            <div className="text-3xl font-bold text-amber-400">{faNum.format(totals.articles)}</div>
            <div className="text-xs text-muted-foreground mt-1">تعداد مواد</div>
          </div>
        </section>

        <section className="glass-raised rounded-2xl p-2 sm:p-4 overflow-x-auto scroll-fade-x">
          <table className="w-full text-sm text-start">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-start py-2 pe-3 font-medium">قانون</th>
                <th className="text-start py-2 pe-3 font-medium">مواد</th>
                <th className="text-start py-2 pe-3 font-medium">معتبر</th>
                <th className="text-start py-2 font-medium">آخرین اصلاح / تصویب</th>
              </tr>
            </thead>
            <tbody>
              {laws.map((law) => {
                const date = law.newest_amended_on || law.newest_approval_date;
                return (
                  <tr key={law.name} className="border-b border-border/50 last:border-0 align-top">
                    <td className="py-3 pe-3">
                      <span className="font-medium">{law.name}</span>
                      {law.is_bill && (
                        <span className="ms-2 inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-400">
                          لایحه — قانون لازم‌الاجرا نیست
                        </span>
                      )}
                    </td>
                    <td className="py-3 pe-3">{faNum.format(law.articles)}</td>
                    <td className="py-3 pe-3">{faNum.format(law.active)}</td>
                    <td className="py-3">{date ? toFa(date) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <p className="text-center text-sm text-muted-foreground">
          پوشش ما در حال گسترش است؛ خروجی جایگزین مشاوره وکیل نیست
        </p>
      </main>

      <EnamadFooter />
    </div>
  );
}
