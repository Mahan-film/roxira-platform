import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Boxes,
  BrainCircuit,
  Calculator,
  Database,
  Globe2,
  Landmark,
  Lock,
  Network,
  ReceiptText,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { PasskeyLoginButton } from "@/components/en/passkey-login-button";
import { EnSettlementPanel } from "@/components/en/en-settlement-panel";
import { SUPPORTED_CURRENCIES } from "@/types/currency";

const MODULES: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  accent: string;
  external?: boolean;
}[] = [
  {
    icon: ReceiptText,
    title: "E-Invoicing",
    description:
      "Issue, validate and archive VAT-compliant invoices with real-time tax calculation and audit trails.",
    href: "/invoicing",
    accent: "text-indigo-300",
  },
  {
    icon: Landmark,
    title: "Accounting",
    description:
      "Full double-entry general ledger, journal entries and trial balance for corporate reporting.",
    href: "/accounting",
    accent: "text-emerald-300",
  },
  {
    icon: Boxes,
    title: "Inventory",
    description:
      "Multi-warehouse stock control with FIFO valuation and cross-border movement tracking.",
    href: "/inventory",
    accent: "text-amber-300",
  },
  {
    icon: Users,
    title: "CRM & Pipeline",
    description:
      "Lead management, kanban sales pipeline and relationship history for enterprise accounts.",
    href: "/crm",
    accent: "text-sky-300",
  },
  {
    icon: Calculator,
    title: "Penalty Calculator",
    description:
      "Interest and late-payment damage computation based on official central-bank indices.",
    href: "/damages",
    accent: "text-rose-300",
  },
  {
    icon: BrainCircuit,
    title: "AI Knowledge Core",
    description:
      "GraphRAG legal knowledge base combining vector search, knowledge graph and LLM dispatch.",
    href: "https://ghazihoushmand.ir",
    accent: "text-violet-300",
    external: true,
  },
];

const TRUST = [
  {
    icon: Server,
    title: "Service monitoring",
    description:
      "Continuous monitoring of the enterprise services with read/write pooling for database workloads.",
  },
  {
    icon: BadgeCheck,
    title: "Regulatory alignment",
    description:
      "Invoices and settlement records are structured for electronic tax reporting.",
  },
  {
    icon: Lock,
    title: "Data protection",
    description:
      "HTTPS transport everywhere and scoped, role-based access control for enterprise data.",
  },
];

export default function InternationalPortal() {
  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#020617]/90 text-slate-100 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-600/30">
              R
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-white">
                Roxira International
              </span>
              <span className="font-mono text-[10px] text-slate-500">
                roxira.net
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm md:flex">
            {[
              { href: "#modules", label: "Modules" },
              { href: "#api", label: "API" },
              { href: "#fx", label: "FX & Settlement" },
              { href: "/docs", label: "Swagger Docs" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="https://roxira.ir"
              className="hidden rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:border-indigo-400/40 hover:text-white sm:inline-flex"
            >
              فارسی
            </a>
            <PasskeyLoginButton />
            <Link
              href="/docs"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
            >
              <BookOpen className="size-3.5" />
              API Access
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_20%_-10%,rgba(79,70,229,0.28),transparent_60%),radial-gradient(700px_360px_at_90%_20%,rgba(34,211,238,0.10),transparent_60%)]"
          />
          <div className="relative mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-cyan-300">
              <Globe2 className="size-3.5" />
              Roxira International B2B Hub
            </span>
            <h1 className="max-w-3xl text-3xl font-black leading-[1.15] tracking-tight sm:text-5xl">
              Cloud enterprise software for
              <span className="bg-gradient-to-r from-indigo-400 to-cyan-300 bg-clip-text text-transparent">
                {" "}
                cross-border finance and commerce
              </span>
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              One integrated platform for invoicing, accounting, inventory and
              customer operations — with a multi-currency settlement layer and a
              documented REST API built for international partners.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
              >
                <BookOpen className="size-4" />
                Explore the API
              </Link>
              <a
                href="#modules"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-bold text-foreground transition-colors hover:bg-accent"
              >
                <Boxes className="size-4" />
                View enterprise modules
              </a>
            </div>

            <dl className="mt-6 grid w-full max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
              {[
                {
                  value: SUPPORTED_CURRENCIES.length.toLocaleString("en-US"),
                  label: "Currencies supported",
                },
                { value: "REST", label: "OpenAPI 3 contracts" },
                { value: "HTTPS", label: "Encrypted transport" },
                { value: "JWT", label: "Scoped API access" },
              ].map((stat) => (
                <div key={stat.label} className="bg-card px-3 py-4">
                  <dt className="text-lg font-black text-indigo-300">
                    {stat.value}
                  </dt>
                  <dd className="mt-1 text-[11px] text-muted-foreground">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          id="modules"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6"
        >
          <div className="mb-8 flex flex-col gap-2">
            <span className="text-xs font-bold text-indigo-300">
              Integrated enterprise suite
            </span>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              Modules ready for your organization
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Each module is an independently deployable service connected to
              the Roxira enterprise core through versioned APIs.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MODULES.map(({ icon: Icon, title, description, href, accent, external }) => {
              const cardClass =
                "group flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-indigo-400/40";
              const inner = (
                <>
                  <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted">
                    <Icon className={`size-5 ${accent}`} />
                  </span>
                  <h3 className="text-lg font-bold">{title}</h3>
                  <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                  <span
                    className={`inline-flex items-center gap-1 text-sm font-semibold ${accent}`}
                  >
                    Open module
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </>
              );
              return external ? (
                <a
                  key={title}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardClass}
                >
                  {inner}
                </a>
              ) : (
                <Link key={title} href={href} className={cardClass}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </section>

        <section
          id="api"
          className="border-y border-border bg-card/40"
        >
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div className="flex flex-col gap-4">
              <span className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-cyan-300">
                <Network className="size-4" />
                Developer platform
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
                Contract-first REST API with Swagger
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Every endpoint is described with an OpenAPI schema and validated
                server-side. Generate typed clients, test requests interactively
                and integrate Roxira modules into your own systems.
              </p>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {[
                  "Versioned endpoints under /api/v1",
                  "Bearer JWT authentication with scoped roles",
                  "Interactive Swagger UI at /docs",
                  "Same-origin proxy — no CORS configuration required",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <BadgeCheck className="size-4 shrink-0 text-cyan-300" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
                >
                  Open Swagger UI
                  <ArrowUpRight className="size-4" />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background/70 p-5">
              <div className="flex items-center justify-between border-b border-border pb-3 text-[11px] font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-cyan-300" />
                  Quick start
                </span>
                <span className="font-mono" dir="ltr">
                  cURL
                </span>
              </div>
              <pre
                dir="ltr"
                className="mt-4 overflow-x-auto font-mono text-[11px] leading-relaxed text-slate-300"
              >
                <code>{`# Authenticate and obtain a JWT
curl -X POST \\
  https://roxira.net/api/backend/auth/verify-otp \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"+98...","code":"<otp>"}'

# Create a multi-currency invoice
curl -X POST \\
  https://roxira.net/api/backend/invoices \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"currency":"EUR","amount":12500}'`}</code>
              </pre>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-[11px] text-muted-foreground">
                <Database className="size-3.5 text-indigo-300" />
                OpenAPI JSON is served alongside the interactive UI.
              </div>
            </div>
          </div>
        </section>

        <section
          id="fx"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6"
        >
          <div className="mb-8 flex flex-col gap-2">
            <span className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-emerald-300">
              <Sparkles className="size-4" />
              Multi-currency reference rates
            </span>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              Multi-currency connection for global trade
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Switch the settlement currency and preview reference conversions for
              USD, EUR, AED and IRR. These reference rates (not live) also power
              invoice and general-ledger calculations across the platform.
            </p>
          </div>

          <EnSettlementPanel />
        </section>

        <section className="border-t border-border bg-card/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="mb-8 flex flex-col items-center gap-2 text-center">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <ShieldCheck className="size-4" />
                Enterprise trust
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
                Security and compliance by design
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Roxira is engineered for sensitive financial and legal
                workloads — resilient, compliant and protective of enterprise
                data.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {TRUST.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted">
                    <Icon className="size-5 text-emerald-300" />
                  </span>
                  <h3 className="font-bold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#020617] text-slate-400">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-xs sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-white">Roxira International B2B Hub</span>
            <span className="font-mono text-[10px] text-slate-500">
              roxira.net · enterprise@roxira.net
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/docs" className="transition-colors hover:text-white">
              API Documentation
            </Link>
            <a href="https://roxira.ir" className="transition-colors hover:text-white">
              Persian Portal
            </a>
            <a
              href="https://ghazihoushmand.ir"
              className="transition-colors hover:text-white"
            >
              Legal AI Assistant
            </a>
          </div>
          <span className="font-mono text-[10px] text-slate-500">
            © {new Date().getFullYear()} Roxira
          </span>
        </div>
      </footer>
    </div>
  );
}
