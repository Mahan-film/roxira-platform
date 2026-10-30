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
  Copy,
  Database,
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
      "Issue, validate and archive VAT-compliant invoices with real-time tax calculation and audit trails.",
    accent: "text-indigo-300",
  },
  {
    key: "accounting",
    icon: Landmark,
    title: "Accounting",
    description:
      "Full double-entry general ledger, journal entries and trial balance for corporate reporting.",
    accent: "text-emerald-300",
  },
  {
    key: "inventory",
    icon: Boxes,
    title: "Inventory",
    description:
      "Multi-warehouse stock control with FIFO valuation and cross-border movement tracking.",
    accent: "text-amber-300",
  },
  {
    key: "crm",
    icon: Users,
    title: "CRM & Pipeline",
    description:
      "Lead management, kanban sales pipeline and relationship history for enterprise accounts.",
    accent: "text-sky-300",
  },
  {
    key: "penalty",
    icon: Calculator,
    title: "Penalty Calculator",
    description:
      "Interest and late-payment damage computation based on official central-bank indices.",
    accent: "text-rose-300",
  },
  {
    key: "ai",
    icon: BrainCircuit,
    title: "AI Knowledge Core",
    description:
      "GraphRAG knowledge engine combining vector search, domain knowledge graph and LLM dispatch.",
    accent: "text-violet-300",
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
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);

  // Request API Modal State
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [orgEmail, setOrgEmail] = useState("");
  const [apiSubmitted, setApiSubmitted] = useState(false);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{
    token: string;
    emailDispatched: boolean;
    quota: string;
  } | null>(null);

  // Upgrade Plan Modal State
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"pro" | "enterprise">("pro");
  const [upgradeEmail, setUpgradeEmail] = useState("");
  const [upgradeCompany, setUpgradeCompany] = useState("");
  const [settlementMethod, setSettlementMethod] = useState<"usdt_usdc" | "corporate_wire">("usdt_usdc");
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeSuccess, setUpgradeSuccess] = useState<{
    proformaId: string;
    plan: string;
    price: string;
    settlementMethod: string;
  } | null>(null);

  const openApiModal = () => {
    setApiModalOpen(true);
    setApiSubmitted(false);
    setApiError(null);
    setCopiedToken(false);
  };

  const openUpgradeModal = (plan: "pro" | "enterprise") => {
    setSelectedPlan(plan);
    setUpgradeModalOpen(true);
    setUpgradeSuccess(null);
    setUpgradeError(null);
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgEmail.trim()) return;

    setApiLoading(true);
    setApiError(null);

    try {
      const res = await fetch("/api/v1/provision-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: orgEmail.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to provision sandbox credentials.");
      }

      setProvisionResult({
        token: data.token,
        emailDispatched: Boolean(data.emailDispatched),
        quota: data.quota || "100 requests / day",
      });
      setApiSubmitted(true);
    } catch (err: unknown) {
      setApiError(
        err instanceof Error
          ? err.message
          : "Failed to connect to credential provisioning service.",
      );
    } finally {
      setApiLoading(false);
    }
  };

  const handleUpgradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradeEmail.trim()) return;

    setUpgradeLoading(true);
    setUpgradeError(null);

    try {
      const res = await fetch("/api/v1/pricing/upgrade-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: upgradeEmail.trim(),
          company: upgradeCompany.trim() || "Enterprise Entity",
          plan: selectedPlan,
          settlementMethod,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate proforma invoice.");
      }

      setUpgradeSuccess({
        proformaId: data.proformaId,
        plan: data.plan,
        price: data.price,
        settlementMethod: data.settlementMethod,
      });
    } catch (err: unknown) {
      setUpgradeError(err instanceof Error ? err.message : "Error processing upgrade inquiry.");
    } finally {
      setUpgradeLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!provisionResult?.token) return;
    navigator.clipboard.writeText(provisionResult.token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2500);
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
              API & MCP
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
              One integrated platform for invoicing, accounting, inventory and
              customer operations — with a multi-currency settlement layer,
              Model Context Protocol (MCP) agent tools, and documented OpenAPI 3
              contracts built for international partners.
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

            <dl className="mt-6 grid w-full max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
              {[
                {
                  value: INTERNATIONAL_CURRENCIES.length.toLocaleString("en-US"),
                  label: "Currencies supported",
                },
                { value: "REST", label: "OpenAPI 3 contracts" },
                { value: "MCP", label: "Agent Tool Protocol" },
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

        {/* MODULES SECTION WITH INTERACTIVE MODAL LAUNCH */}
        <section
          id="modules"
          className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6"
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
              the Roxira enterprise core through versioned APIs. Click any module
              to test its interactive sandbox workspace.
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
                  Open module sandbox
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
                Developer platform & MCP Tool Server
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
                Contract-first REST API & MCP Tools
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Every endpoint is described with an OpenAPI schema and validated
                server-side. AI agents can also integrate directly via Model
                Context Protocol (MCP) tool manifests and execution endpoints.
              </p>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {[
                  "Versioned endpoints under /api/backend/ and /api/v1/",
                  "Bearer JWT authentication with scoped roles",
                  "Deterministic AI Agent tools at /api/v1/mcp/manifest",
                  "Direct execution endpoint at /api/v1/mcp/execute",
                  "Autonomous Agent docs at /llms.txt",
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
                  Agent docs (llms.txt)
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
                  cURL
                </span>
              </div>
              <pre
                dir="ltr"
                className="mt-4 overflow-x-auto font-mono text-[11px] leading-relaxed text-slate-300"
              >
                <code>{`# Authenticate and obtain a JWT
curl -X POST \\
  https://roxira.net/api/v1/provision-sandbox \\
  -H "Content-Type: application/json" \\
  -d '{"email":"your-email@company.com"}'

# Create a multi-currency invoice (Live Endpoint)
curl -X POST \\
  https://roxira.net/api/backend/invoices \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"currency":"EUR","amount":12500}'`}</code>
              </pre>
              <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Database className="size-3.5 text-indigo-300" />
                  OpenAPI JSON & MCP Tool Manifest available.
                </span>
                <a
                  href="/api/v1/mcp/manifest"
                  target="_blank"
                  className="text-cyan-300 hover:underline font-mono"
                >
                  /mcp/manifest →
                </a>
              </div>
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
              USD, EUR, GBP, AED, and other international pairs. These reference rates
              power invoice and general-ledger calculations across the platform.
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

        {/* PRICING & API TIERS */}
        <section
          id="pricing"
          className="scroll-mt-24 border-t border-border bg-[#05070e] py-16"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="mb-12 flex flex-col items-center gap-2 text-center">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400">
                <Sparkles className="size-4" />
                Monetization & API Tiers
              </span>
              <h2 className="text-2xl font-black tracking-tight sm:text-4xl text-white">
                Predictable pricing for developers and enterprise scale
              </h2>
              <p className="max-w-2xl text-sm text-slate-400">
                Start with our free sandbox tier or upgrade for high-throughput AI agent execution,
                dedicated PostgreSQL ledger storage, and custom SLA guarantees.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* Plan 1: Sandbox Tier */}
              <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#0c101c] p-6 hover:border-indigo-500/30 transition">
                <div className="space-y-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Sandbox Tier</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">$0</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Designed for rapid prototyping and testing cross-border enterprise contracts.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-white/5">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      100 API & MCP tool calls / day
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Full access to 6 sandbox modules
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Instant Scoped JWT Bearer token
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      OpenAPI 3 & Model Context Protocol (MCP)
                    </li>
                  </ul>
                </div>
                <button
                  onClick={openApiModal}
                  className="mt-6 w-full rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 py-2.5 text-xs font-semibold text-white transition"
                >
                  Get Free Sandbox Key
                </button>
              </div>

              {/* Plan 2: Pro Agent & Developer */}
              <div className="relative flex flex-col justify-between rounded-2xl border-2 border-indigo-500/60 bg-gradient-to-b from-[#11162b] to-[#0c101c] p-6 shadow-xl shadow-indigo-600/10">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Most Popular for AI Agents
                </div>
                <div className="space-y-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Pro Agent & Dev</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">$49</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Production throughput for autonomous agents, automated billing, and live ERP integration.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-white/10">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      50,000 tool executions / month
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Persistent PostgreSQL Ledger & Qdrant Shard
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Direct MCP Execution Endpoint
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Multi-tenant cryptographic data isolation
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-indigo-400 shrink-0" />
                      Priority 99.9% uptime SLA
                    </li>
                  </ul>
                </div>
                <button
                  onClick={() => openUpgradeModal("pro")}
                  className="mt-6 w-full rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition"
                >
                  Upgrade to Pro Tier →
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
                    Custom multi-jurisdiction compliance nodes, unlimited API throughput, and custom FX contracts.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-white/5">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Unlimited throughput & dedicated EU/MENA node
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Live Central-Bank reference FX feeds
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Reverse-Charge VAT validation engine
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Corporate wire & Stablecoin settlement
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      Dedicated enterprise account executive
                    </li>
                  </ul>
                </div>
                <button
                  onClick={() => openUpgradeModal("enterprise")}
                  className="mt-6 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 py-2.5 text-xs font-semibold text-emerald-200 transition"
                >
                  Request Enterprise SLA →
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
            <span className="text-[10px] text-slate-500">
              543 Birch St, San Francisco, CA 94102, USA
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
              API & MCP
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

      {/* REQUEST API ACCESS LEAD MODAL */}
      {apiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-white/15 bg-[#0b0e17] p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <BookOpen className="size-4 text-indigo-400" />
                Request Scoped API & Agent Access
              </h3>
              <button
                onClick={() => setApiModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="size-4" />
              </button>
            </div>

            {!apiSubmitted ? (
              <form onSubmit={handleProvisionSubmit} className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Enter your corporate email to generate a real HMAC-SHA256 Scoped JWT
                  token (100 req/day quota) and receive the OpenAPI 3 client bundle via email.
                </p>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={orgEmail}
                  onChange={(e) => setOrgEmail(e.target.value)}
                  disabled={apiLoading}
                  className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                />

                {apiError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">
                    {apiError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={apiLoading}
                  className="w-full rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 py-2.5 text-xs font-semibold text-white transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {apiLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Provisioning Scoped Credentials & Dispatching Email...
                    </>
                  ) : (
                    "Generate Sandbox Credentials"
                  )}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs space-y-1.5">
                  <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <BadgeCheck className="size-4 text-emerald-400 shrink-0" />
                    Credentials Provisioned for {orgEmail}
                  </p>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    {provisionResult?.emailDispatched
                      ? `✓ Full credentials and OpenAPI bundle dispatched to your inbox via info@roxira.net.`
                      : `Scoped JWT generated. Quota: ${provisionResult?.quota}. You can start testing immediately.`}
                  </p>
                </div>

                {provisionResult?.token && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-medium">Scoped Bearer JWT:</span>
                      <button
                        onClick={copyToClipboard}
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition"
                      >
                        {copiedToken ? (
                          <>
                            <Check className="size-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            <span>Copy Scoped JWT</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="rounded-lg bg-black/60 border border-white/10 p-2.5 font-mono text-[10px] text-cyan-300 break-all select-all max-h-24 overflow-y-auto">
                      {provisionResult.token}
                    </div>
                  </div>
                )}

                <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3 text-[11px] space-y-1 text-slate-400">
                  <p className="font-semibold text-slate-200">🤖 AI Agent Integration:</p>
                  <p>
                    Point LangGraph, Claude or Cursor MCP client to:
                  </p>
                  <code className="text-indigo-300 font-mono text-[10px] block bg-black/40 px-2 py-1 rounded">
                    https://roxira.net/api/v1/mcp/manifest
                  </code>
                </div>

                <button
                  onClick={() => setApiModalOpen(false)}
                  className="w-full rounded-lg bg-white/10 hover:bg-white/15 py-2 text-xs font-medium text-white transition"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* UPGRADE PLAN PROFORMA INVOICE MODAL */}
      {upgradeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-white/15 bg-[#0b0e17] p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CreditCard className="size-4 text-emerald-400" />
                Upgrade to {selectedPlan === "enterprise" ? "Enterprise B2B Hub" : "Pro Agent Tier"}
              </h3>
              <button
                onClick={() => setUpgradeModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="size-4" />
              </button>
            </div>

            {!upgradeSuccess ? (
              <form onSubmit={handleUpgradeSubmit} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Corporate Domain Email</label>
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={upgradeEmail}
                    onChange={(e) => setUpgradeEmail(e.target.value)}
                    disabled={upgradeLoading}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Company / Legal Entity</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Acme FinTech Corp"
                    value={upgradeCompany}
                    onChange={(e) => setUpgradeCompany(e.target.value)}
                    disabled={upgradeLoading}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Selected Plan Tier</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPlan("pro")}
                      className={`rounded-xl border p-3 text-left transition ${
                        selectedPlan === "pro"
                          ? "border-indigo-500 bg-indigo-500/15 text-white"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                    >
                      <div className="font-bold">Pro Agent & Dev</div>
                      <div className="text-[11px] text-slate-400">$49 / month</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlan("enterprise")}
                      className={`rounded-xl border p-3 text-left transition ${
                        selectedPlan === "enterprise"
                          ? "border-emerald-500 bg-emerald-500/15 text-white"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                    >
                      <div className="font-bold">Enterprise Hub</div>
                      <div className="text-[11px] text-slate-400">$299 / month</div>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Preferred Settlement Method</label>
                  <select
                    value={settlementMethod}
                    onChange={(e) =>
                      setSettlementMethod(e.target.value as "usdt_usdc" | "corporate_wire")
                    }
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-white text-xs"
                  >
                    <option value="usdt_usdc">Instant Stablecoin (USDT / USDC via TRC20/ERC20)</option>
                    <option value="corporate_wire">International Corporate Wire (EUR / USD via SWIFT)</option>
                  </select>
                </div>

                {upgradeError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">
                    {upgradeError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={upgradeLoading}
                  className="w-full rounded-xl bg-gradient-to-l from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 py-2.5 text-xs font-bold text-white transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {upgradeLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Generating Proforma Invoice & Notifying Billing...
                    </>
                  ) : (
                    "Generate Official Proforma Invoice →"
                  )}
                </button>
              </form>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
                  <p className="font-semibold text-emerald-300 flex items-center gap-1.5 text-sm">
                    <BadgeCheck className="size-5 text-emerald-400 shrink-0" />
                    Proforma Invoice Generated ({upgradeSuccess.proformaId})
                  </p>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    An official proforma invoice with settlement specifications has been sent to{" "}
                    <code className="text-white font-mono">{upgradeEmail}</code>.
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2 font-mono text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>Invoice Ref:</span>
                    <span className="text-white font-bold">{upgradeSuccess.proformaId}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Selected Plan:</span>
                    <span className="text-indigo-300">{upgradeSuccess.plan}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Amount Due:</span>
                    <span className="text-emerald-400 font-bold">{upgradeSuccess.price}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Settlement Mode:</span>
                    <span className="text-slate-200">{upgradeSuccess.settlementMethod}</span>
                  </div>
                </div>

                <div className="rounded-lg bg-black/40 border border-white/10 p-3 text-[11px] text-slate-300 leading-relaxed">
                  To complete activation, reply to the email sent to you or contact{" "}
                  <code className="text-indigo-300">info@roxira.net</code> with your transaction reference.
                </div>

                <button
                  onClick={() => setUpgradeModalOpen(false)}
                  className="w-full rounded-lg bg-white/10 hover:bg-white/15 py-2 text-xs font-medium text-white transition"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
