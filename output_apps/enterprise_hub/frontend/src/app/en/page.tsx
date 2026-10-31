"use client";

import React, { useState } from "react";
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
  Check,
  CreditCard,
  Globe2,
  Landmark,
  Loader2,
  Lock,
  Network,
  ReceiptText,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { PasskeyLoginButton } from "@/components/en/passkey-login-button";
import { EnSettlementPanel } from "@/components/en/en-settlement-panel";
import { INTERNATIONAL_CURRENCIES } from "@/types/currency";
import ModuleSandboxModal, { ModuleKey } from "@/components/en/ModuleSandboxModal";

const MODULES: {
  key: ModuleKey;
  icon: LucideIcon;
  title: string;
  description: string;
  accent: string;
}[] = [
  {
    key: "invoicing",
    icon: ReceiptText,
    title: "E-Invoicing",
    description:
      "VAT invoices with automatic tax calculation. In development; the demo uses sample data.",
    accent: "text-indigo-300",
  },
  {
    key: "accounting",
    icon: Landmark,
    title: "Accounting",
    description:
      "Double-entry ledger, journal entries and trial balance. In development; the demo uses sample data.",
    accent: "text-emerald-300",
  },
  {
    key: "inventory",
    icon: Boxes,
    title: "Inventory",
    description:
      "Multi-warehouse stock with FIFO valuation. In development; the demo uses sample data.",
    accent: "text-amber-300",
  },
  {
    key: "crm",
    icon: Users,
    title: "CRM & Pipeline",
    description:
      "Lead management and a kanban sales pipeline. In development; the demo uses sample data.",
    accent: "text-sky-300",
  },
  {
    key: "penalty",
    icon: Calculator,
    title: "Penalty Calculator",
    description:
      "Late-payment interest calculator. The demo uses the rate you type; there is no index feed.",
    accent: "text-rose-300",
  },
  {
    key: "ai",
    icon: BrainCircuit,
    title: "AI Knowledge Core",
    description:
      "AI assistant over your books. Planned; the demo only shows placeholder text.",
    accent: "text-violet-300",
  },
];

const TRUST = [
  {
    icon: Server,
    title: "Service monitoring",
    description:
      "Health checks run on the services behind this site.",
  },
  {
    icon: BadgeCheck,
    title: "Tax reporting",
    description:
      "Per-country tax rules are planned. None is certified or approved by a tax authority yet.",
  },
  {
    icon: Lock,
    title: "Data protection",
    description:
      "HTTPS transport and role-based access control.",
  },
];

export default function InternationalPortal() {
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);

  // Request-access modal state (API early access and plan requests)
  type LeadPlan = "api" | "pro" | "enterprise";
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadPlan, setLeadPlan] = useState<LeadPlan>("api");
  const [leadName, setLeadName] = useState("");
  const [leadCompany, setLeadCompany] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [leadDone, setLeadDone] = useState<{ reference: string | null } | null>(null);

  const openLeadModal = (plan: LeadPlan) => {
    setLeadPlan(plan);
    setLeadOpen(true);
    setLeadDone(null);
    setLeadError(null);
  };
  const openApiModal = () => openLeadModal("api");
  const openUpgradeModal = (plan: "pro" | "enterprise") => openLeadModal(plan);

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeadLoading(true);
    setLeadError(null);
    try {
      const res = await fetch("/api/v1/pricing/upgrade-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: leadName.trim(),
          company: leadCompany.trim(),
          email: leadEmail.trim(),
          phone: leadPhone.trim(),
          plan: leadPlan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "We could not record your request. Please email info@roxira.net.");
      }
      setLeadDone({ reference: data.reference ?? null });
    } catch (err: unknown) {
      setLeadError(err instanceof Error ? err.message : "We could not record your request.");
    } finally {
      setLeadLoading(false);
    }
  };

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground scroll-smooth">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#020617]/90 text-slate-100 backdrop-blur">
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
            <a
              href="#modules"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              Modules
            </a>
            <a
              href="#api"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              API
            </a>
            <a
              href="#fx"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              FX & Settlement
            </a>
            <a
              href="#pricing"
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              Pricing & Tiers
            </a>
            <button
              onClick={openApiModal}
              className="rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              Request API access
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <PasskeyLoginButton />
            <button
              onClick={openApiModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
            >
              <BookOpen className="size-3.5" />
              Request API access
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* HERO SECTION */}
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
              An accounting suite for international companies: invoicing, ledger,
              inventory and customers with multi-currency support. It is in
              development. Try the interactive demos and tell us what you need.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={openApiModal}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
              >
                <BookOpen className="size-4" />
                Request API access
              </button>
              <a
                href="#pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-bold text-foreground transition-colors hover:bg-accent"
              >
                <CreditCard className="size-4 text-indigo-400" />
                View pricing plans
              </a>
            </div>

            <dl className="mt-6 grid w-full max-w-sm grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
              {[
                {
                  value: INTERNATIONAL_CURRENCIES.length.toLocaleString("en-US"),
                  label: "Currencies listed",
                },
                { value: "6", label: "Demo modules" },
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

        {/* MODULES SECTION WITH INTERACTIVE MODAL LAUNCH */}
        <section
          id="modules"
          className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6"
        >
          <div className="mb-8 flex flex-col gap-2">
            <span className="text-xs font-bold text-indigo-300">
              Accounting suite (in development)
            </span>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              Module demos
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Click any module to open an interactive demo with sample data. Demos run
              in your browser; nothing is saved.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MODULES.map(({ key, icon: Icon, title, description, accent }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveModule(key)}
                className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 text-left transition-all hover:border-indigo-400/50 hover:bg-card/80 cursor-pointer"
              >
                <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted">
                  <Icon className={`size-5 ${accent}`} />
                </span>
                <h3 className="text-lg font-bold">{title}</h3>
                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold ${accent}`}
                >
                  Open demo
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* API SECTION */}
        <section
          id="api"
          className="scroll-mt-24 border-y border-border bg-card/40"
        >
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div className="flex flex-col gap-4">
              <span className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-cyan-300">
                <Network className="size-4" />
                Developer access (planned)
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
                Public API and AI-agent tools
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                A public REST API and Model Context Protocol (MCP) tools are
                planned. They are not available yet. Request early access and we
                will contact you when they are.
              </p>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {[
                  "Not available yet: no API keys are issued",
                  "Request early access and we will contact you",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <BadgeCheck className="size-4 shrink-0 text-cyan-300" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  onClick={openApiModal}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
                >
                  Request API access
                  <ArrowUpRight className="size-4" />
                </button>
                <a
                  href="/llms.txt"
                  target="_blank"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-accent"
                >
                  About this site (llms.txt)
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background/70 p-5">
              <div className="flex items-center justify-between border-b border-border pb-3 text-[11px] font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-cyan-300" />
                  Quick start
                </span>
                <span className="font-mono" dir="ltr">
                  Status
                </span>
              </div>
              <pre
                dir="ltr"
                className="mt-4 overflow-x-auto font-mono text-[11px] leading-relaxed text-slate-300"
              >
<code>{`Public API: not available yet.
Request early access and we will contact you.`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* FX & SETTLEMENT SECTION */}
        <section
          id="fx"
          className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6"
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
              USD, EUR, GBP, AED, and other international pairs. The rates shown are
              indicative reference values for this preview, not live market quotes.
              Currency normalization in the accounting suite is in development.
            </p>
          </div>

          <EnSettlementPanel />
        </section>

        {/* TRUST & COMPLIANCE SECTION */}
        <section
          id="trust"
          className="scroll-mt-24 border-t border-border bg-card/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="mb-8 flex flex-col items-center gap-2 text-center">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <ShieldCheck className="size-4" />
                Trust
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
                Security basics
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                What is in place today. We list no certification we do not hold.
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

        {/* PRICING & API TIERS */}
        <section
          id="pricing"
          className="scroll-mt-24 border-t border-border bg-[#05070e] py-16"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="mb-12 flex flex-col items-center gap-2 text-center">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400">
                <Sparkles className="size-4" />
                Pricing (indicative)
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-4xl text-white">
                Planned tiers
              </h2>
              <p className="max-w-2xl text-sm text-slate-400">
                Prices are indicative and not final. Paid tiers are not on sale yet.
                Request early access and we will contact you.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* Plan 1: Sandbox Tier */}
              <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#0c101c] p-6 hover:border-indigo-500/30 transition">
                <div className="space-y-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Demo</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">$0</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Try the interactive demos with sample data.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-white/5">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Interactive browser demos
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      6 demo modules
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      No account needed
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Nothing is saved
                    </li>
                  </ul>
                </div>
                <button
                  onClick={() => setActiveModule("invoicing")}
                  className="mt-6 w-full rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 py-2.5 text-xs font-semibold text-white transition"
                >
                  Open the demos
                </button>
              </div>

              {/* Plan 2: Pro Agent & Developer */}
              <div className="relative flex flex-col justify-between rounded-2xl border-2 border-indigo-500/60 bg-gradient-to-b from-[#11162b] to-[#0c101c] p-6 shadow-xl shadow-indigo-600/10">
                <div className="space-y-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Pro Agent & Dev</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">$49</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    For developers and automation. Not on sale yet.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-white/10">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Limits not defined yet
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Hosted ledger (in development)
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      API access (planned)
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Tenant-scoped data access
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Support terms agreed per customer
                    </li>
                  </ul>
                </div>
                <button
                  onClick={() => openUpgradeModal("pro")}
                  className="mt-6 w-full rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition"
                >
                  Request Pro access →
                </button>
              </div>

              {/* Plan 3: Enterprise B2B Hub */}
              <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#0c101c] p-6 hover:border-emerald-500/30 transition">
                <div className="space-y-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Enterprise B2B Hub</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">$299</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    For larger organizations. Terms agreed per customer.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-white/5">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Custom deployment agreed per customer
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Multi-currency with dated reference rates (planned)
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Per-country tax profiles (planned)
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Payment terms agreed per customer
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Direct contact with the team
                    </li>
                  </ul>
                </div>
                <button
                  onClick={() => openUpgradeModal("enterprise")}
                  className="mt-6 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 py-2.5 text-xs font-semibold text-emerald-200 transition"
                >
                  Request Enterprise access →
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-white/10 bg-[#020617] text-slate-400">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-xs sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-white">Roxira International B2B Hub</span>
            <span className="font-mono text-[10px] text-slate-400">
              roxira.net · info@roxira.net
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={openApiModal}
              className="transition-colors hover:text-white"
            >
              Request API access
            </button>
            <a href="#modules" className="transition-colors hover:text-white">
              Modules
            </a>
            <a href="#api" className="transition-colors hover:text-white">
              API
            </a>
            <a href="#pricing" className="transition-colors hover:text-white">
              Pricing
            </a>
            <a href="/llms.txt" target="_blank" className="transition-colors hover:text-white">
              llms.txt
            </a>
          </div>
          <span className="font-mono text-[10px] text-slate-500">
            © {new Date().getFullYear()} Roxira
          </span>
        </div>
      </footer>

      {/* INTERACTIVE MODULE SANDBOX MODAL */}
      <ModuleSandboxModal
        activeModule={activeModule}
        onClose={() => setActiveModule(null)}
        onSelectModule={(mod) => setActiveModule(mod)}
        onRequestApiClick={() => {
          setActiveModule(null);
          openApiModal();
        }}
      />

      {/* REQUEST ACCESS MODAL: stores a lead, issues nothing */}
      {leadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-white/15 bg-[#0b0e17] p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <BookOpen className="size-4 text-indigo-400" />
                Request early access
              </h3>
              <button
                onClick={() => setLeadOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            {!leadDone ? (
              <form onSubmit={handleLeadSubmit} className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  The platform is in development. This form sends us your contact details; it does not
                  create an account, an API key or an invoice. We will contact you.
                </p>
                <div>
                  <label className="block text-slate-400 mb-1 text-xs">What are you interested in?</label>
                  <select
                    value={leadPlan}
                    onChange={(e) => setLeadPlan(e.target.value as LeadPlan)}
                    disabled={leadLoading}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="api">API early access</option>
                    <option value="pro">Pro Agent &amp; Developer tier</option>
                    <option value="enterprise">Enterprise B2B Hub tier</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-xs">Your name</label>
                  <input
                    type="text"
                    required
                    placeholder="Full name"
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    disabled={leadLoading}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-xs">Company / legal entity</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Acme FinTech Corp"
                    value={leadCompany}
                    onChange={(e) => setLeadCompany(e.target.value)}
                    disabled={leadLoading}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-xs">Corporate email</label>
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                    disabled={leadLoading}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 text-xs">Phone (with country code)</label>
                  <input
                    type="tel"
                    required
                    placeholder="+971 ..."
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    disabled={leadLoading}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  />
                </div>

                {leadError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">
                    {leadError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={leadLoading}
                  className="w-full rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 py-2.5 text-xs font-semibold text-white transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {leadLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send request"
                  )}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs space-y-1.5">
                  <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <BadgeCheck className="size-4 text-emerald-400 shrink-0" />
                    Request received{leadDone.reference ? ` (${leadDone.reference})` : ""}
                  </p>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    We will contact you at {leadEmail}. No account, key or invoice has been issued.
                  </p>
                </div>
                <button
                  onClick={() => setLeadOpen(false)}
                  className="w-full rounded-lg bg-white/10 hover:bg-white/15 py-2 text-xs font-medium text-white transition"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
