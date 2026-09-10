import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "داشبورد" },
  { href: "/invoicing", label: "فاکتورها" },
  { href: "/damages", label: "محاسبه خسارت" },
  { href: "/judge", label: "قاضی هوشمند" },
  { href: "/docs", label: "مستندات API" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#020617]/90 text-slate-100 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-600/30">
            R
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-white">پورتال سازمانی روکسیرا</span>
            <span className="font-mono text-[10px] text-slate-500" dir="ltr">
              roxira.ir
            </span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/invoicing"
          className="inline-flex items-center rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
        >
          ورود به سامانه
        </Link>
      </div>
    </header>
  );
}
