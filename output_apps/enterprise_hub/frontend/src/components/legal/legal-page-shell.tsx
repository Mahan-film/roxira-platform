import Link from "next/link";
import { Gavel, Scale } from "lucide-react";

/**
 * پوسته مشترک صفحات عمومی پایگاه دانش حقوقی (دامنه ghazihoushmand.ir).
 *
 * این کامپوننت React Server Component است تا صفحات داینامیک `laws/[slug]`
 * و `precedents/[slug]` کاملاً روی سرور رندر شده و برای خزشگرها قابل
 * ایندکس باشند.
 */
export function LegalPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#050505]/90 text-slate-100 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="https://ghazihoushmand.ir/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg shadow-orange-600/30">
              <Gavel className="size-4" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-white">قاضی هوشمند</span>
              <span className="font-mono text-[10px] text-slate-500" dir="ltr">
                ghazihoushmand.ir
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/laws"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              مواد قانونی
            </Link>
            <Link
              href="/precedents"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              آرای وحدت رویه
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-amber-500 to-orange-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-orange-600/30 transition-transform hover:-translate-y-0.5"
            >
              <Scale className="size-3.5" />
              تحلیل پرونده
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-white/10 bg-[#050505] text-slate-400">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center justify-between gap-3 px-4 py-6 text-[11px] sm:flex-row sm:px-6">
          <span>
            پایگاه دانش حقوقی «قاضی هوشمند» — ماده‌ها قانونی و آرای وحدت رویه لازم‌الاتباع
          </span>
          <span className="flex items-center gap-3 font-mono" dir="ltr">
            <a href="https://ghazihoushmand.ir" className="hover:text-white">
              ghazihoushmand.ir
            </a>
            <span className="text-slate-700">·</span>
            <a href="https://roxira.ir" className="hover:text-white">
              roxira.ir
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
