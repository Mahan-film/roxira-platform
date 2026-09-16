"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Lock,
  Play,
  Send,
  Server,
} from "lucide-react";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface ApiEndpoint {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  auth: boolean;
  requestExample?: string;
  responseExample: string;
}

interface ApiGroup {
  id: string;
  name: string;
  description: string;
  endpoints: ApiEndpoint[];
}

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  POST: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
  PATCH: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  DELETE: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

const API_GROUPS: ApiGroup[] = [
  {
    id: "tax-invoicing",
    name: "Tax Invoicing",
    description:
      "صدور و مدیریت صورتحساب الکترونیکی و امضای دیجیتال مالیاتی برای سامانه مودیان.",
    endpoints: [
      {
        id: "invoicing-create",
        method: "POST",
        path: "/api/backend/enterprise-hub/invoicing",
        summary: "صدور صورتحساب الکترونیکی جدید",
        auth: true,
        requestExample: '{\n  "customerName": "شرکت نمونه",\n  "amount": 15000000,\n  "currency": "IRR",\n  "description": "خرید خدمات"\n}',
        responseExample: '{\n  "id": "inv_01HZX",\n  "status": "ISSUED",\n  "amount": 15000000,\n  "createdAt": "2026-09-16T10:00:00Z"\n}',
      },
      {
        id: "invoicing-list",
        method: "GET",
        path: "/api/backend/enterprise-hub/invoicing",
        summary: "فهرست صورتحساب‌های سازمان",
        auth: true,
        responseExample: '{\n  "items": [\n    { "id": "inv_01HZX", "status": "ISSUED", "amount": 15000000 }\n  ],\n  "total": 1\n}',
      },
      {
        id: "invoicing-cancel",
        method: "PATCH",
        path: "/api/backend/enterprise-hub/invoicing/{id}/cancel",
        summary: "ابطال صورتحساب بر اساس شناسه",
        auth: true,
        responseExample: '{\n  "id": "inv_01HZX",\n  "status": "CANCELLED"\n}',
      },
      {
        id: "tax-sign-invoice",
        method: "POST",
        path: "/api/backend/enterprise-hub/tax-compliance/sign-invoice",
        summary: "امضای الکترونیک صورتحساب و تولید بسته مالیاتی (TaxID + JWS)",
        auth: true,
        requestExample: '{\n  "invoiceId": "inv_01HZX",\n  "taxpayerId": "14001234567"\n}',
        responseExample: '{\n  "id": "sig_01HZY",\n  "status": "SIGNED",\n  "taxId": "14001234567-...",\n  "jws": "eyJ..."\n}',
      },
      {
        id: "tax-submit",
        method: "POST",
        path: "/api/backend/enterprise-hub/tax-compliance/signatures/{id}/submit",
        summary: "ارسال بسته امضاشده به سامانه مودیان و ثبت شماره مرجع",
        auth: true,
        responseExample: '{\n  "id": "sig_01HZY",\n  "status": "SUBMITTED",\n  "referenceNumber": "A1B2C3D4"\n}',
      },
      {
        id: "tax-verify",
        method: "GET",
        path: "/api/backend/enterprise-hub/tax-compliance/signatures/{id}/verify",
        summary: "راستی‌آزمایی صحت امضای JWS یک بسته",
        auth: true,
        responseExample: '{\n  "valid": true,\n  "algorithm": "ES256"\n}',
      },
      {
        id: "tax-active-key",
        method: "GET",
        path: "/api/backend/enterprise-hub/tax-compliance/keys/active",
        summary: "اطلاعات عمومی کلید فعال مالیاتی سازمان",
        auth: true,
        responseExample: '{\n  "keyId": "key_2026",\n  "algorithm": "ES256",\n  "publicKey": "MFkwEw..."\n}',
      },
      {
        id: "tax-csr",
        method: "POST",
        path: "/api/backend/enterprise-hub/tax-compliance/csr",
        summary: "تولید درخواست امضای گواهی (CSR) با کلید فعال",
        auth: true,
        requestExample: '{\n  "commonName": "Roxira Enterprise",\n  "organization": "Roxira"\n}',
        responseExample: '{\n  "csr": "-----BEGIN CERTIFICATE REQUEST-----",\n  "keyId": "key_2026"\n}',
      },
    ],
  },
  {
    id: "accounting",
    name: "Accounting",
    description: "دفتر کل دوطرفه، ثبت اسناد حسابداری و گزارش‌های مالی.",
    endpoints: [
      {
        id: "accounting-accounts-list",
        method: "GET",
        path: "/api/backend/enterprise-hub/accounting/accounts",
        summary: "فهرست حساب‌های دفتر کل",
        auth: true,
        responseExample: '[\n  { "code": "1000", "name": "موجودی نقد", "type": "ASSET" },\n  { "code": "4000", "name": "درآمد فروش", "type": "REVENUE" }\n]',
      },
      {
        id: "accounting-accounts-create",
        method: "POST",
        path: "/api/backend/enterprise-hub/accounting/accounts",
        summary: "ایجاد حساب جدید در دفتر کل",
        auth: true,
        requestExample: '{\n  "code": "1010",\n  "name": "بانک ملت",\n  "type": "ASSET"\n}',
        responseExample: '{\n  "code": "1010",\n  "name": "بانک ملت",\n  "type": "ASSET"\n}',
      },
      {
        id: "accounting-journal-create",
        method: "POST",
        path: "/api/backend/enterprise-hub/accounting/journal-entries",
        summary: "ثبت سند دوطرفه (بدهکار/بستانکار)",
        auth: true,
        requestExample: '{\n  "description": "فروش نقدی",\n  "lines": [\n    { "accountCode": "1000", "debit": 15000000, "credit": 0 },\n    { "accountCode": "4000", "debit": 0, "credit": 15000000 }\n  ]\n}',
        responseExample: '{\n  "id": 42,\n  "entryNumber": "JE-1405-0042",\n  "status": "POSTED"\n}',
      },
      {
        id: "accounting-journal-list",
        method: "GET",
        path: "/api/backend/enterprise-hub/accounting/journal-entries",
        summary: "فهرست صفحه‌بندی‌شده اسناد",
        auth: true,
        responseExample: '{\n  "items": [\n    { "id": 42, "entryNumber": "JE-1405-0042", "status": "POSTED" }\n  ],\n  "total": 1,\n  "page": 1\n}',
      },
      {
        id: "accounting-trial-balance",
        method: "GET",
        path: "/api/backend/enterprise-hub/accounting/trial-balance",
        summary: "تراز آزمایشی دفتر کل",
        auth: true,
        responseExample: '{\n  "rows": [\n    { "code": "1000", "debit": 15000000, "credit": 0 }\n  ],\n  "balanced": true\n}',
      },
      {
        id: "accounting-ledger",
        method: "GET",
        path: "/api/backend/enterprise-hub/accounting/accounts/{code}/ledger",
        summary: "گردش یک حساب بر اساس کد",
        auth: true,
        responseExample: '{\n  "code": "1000",\n  "entries": [],\n  "openingBalance": 0,\n  "closingBalance": 15000000\n}',
      },
    ],
  },
  {
    id: "factory",
    name: "Factory Synthesis",
    description:
      "کارخانه نرم‌افزار خودمختار: ساخت، بیلد و استقرار خودکار اپ در محیط ایزوله.",
    endpoints: [
      {
        id: "factory-synthesize-app",
        method: "POST",
        path: "/api/v1/factory/synthesize-app",
        summary: "ثبت درخواست ساخت اپ و بازگشت شناسه پیگیری",
        auth: false,
        requestExample: '{\n  "app_name": "demo-crm-suite",\n  "specification": "Create a CRM lead capture landing page",\n  "target_framework": "NextJS",\n  "tier": "FRONTIER"\n}',
        responseExample: '{\n  "status": "QUEUED",\n  "stage": "QUEUED",\n  "app_id": "demo-crm-suite",\n  "poll": "/api/v1/factory/synthesize-app/demo-crm-suite"\n}',
      },
      {
        id: "factory-synthesize-alias",
        method: "POST",
        path: "/api/v1/factory/synthesize",
        summary: "نام مستعار برای ثبت درخواست ساخت",
        auth: false,
        requestExample: '{\n  "app_name": "demo-crm-suite",\n  "specification": "Create a CRM lead capture landing page"\n}',
        responseExample: '{\n  "status": "QUEUED",\n  "app_id": "demo-crm-suite"\n}',
      },
      {
        id: "factory-status",
        method: "GET",
        path: "/api/v1/factory/synthesize-app/{app_id}",
        summary: "وضعیت زنده ساخت و مراحل پایپ‌لاین اپ",
        auth: false,
        responseExample: '{\n  "app_id": "demo-crm-suite",\n  "stage": "RUNNING",\n  "host_port": 4123,\n  "subdomain": "demo-crm-suite.roxira.app",\n  "stages": [\n    { "stage": "QUEUED" },\n    { "stage": "BUILDING" },\n    { "stage": "RUNNING" }\n  ]\n}',
      },
    ],
  },
];

const ALL_ENDPOINTS = API_GROUPS.flatMap((group) =>
  group.endpoints.map((endpoint) => ({ ...endpoint, groupId: group.id })),
);

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 font-mono text-[10px] text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
    >
      {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      {copied ? "COPIED" : label}
    </button>
  );
}

function TryItPanel({ endpoint }: { endpoint: ApiEndpoint }) {
  const [body, setBody] = useState(endpoint.requestExample ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ status: number; text: string } | null>(null);
  const hasPlaceholder = endpoint.path.includes("{");

  const send = async () => {
    if (sending || hasPlaceholder) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(endpoint.path, {
        method: endpoint.method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body && endpoint.method !== "GET" ? body : undefined,
      });
      const text = await res.text();
      setResult({ status: res.status, text: text.slice(0, 2000) });
    } catch (error) {
      setResult({
        status: 0,
        text: error instanceof Error ? error.message : "request failed",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-bold text-slate-300">TRY IT</span>
        {hasPlaceholder ? (
          <span className="font-mono text-[10px] text-slate-600">
            needs path parameter — edit the URL and send from your client
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 font-mono text-[10px] font-bold text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
          >
            {sending ? (
              <Play className="size-3 animate-pulse" />
            ) : (
              <Send className="size-3" />
            )}
            {sending ? "SENDING…" : "SEND"}
          </button>
        )}
      </div>

      {endpoint.method !== "GET" && (
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          spellCheck={false}
          className="mt-3 w-full resize-none rounded-xl border border-slate-800 bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-200 outline-none focus:border-indigo-400/50"
        />
      )}

      {result && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px]">
            <span className={result.status >= 200 && result.status < 300 ? "text-emerald-300" : "text-rose-300"}>
              HTTP {result.status}
            </span>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
            {result.text || "(empty response)"}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ApiExplorer() {
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string>(ALL_ENDPOINTS[0].id);

  const visibleGroups = useMemo(
    () => (groupFilter === "all" ? API_GROUPS : API_GROUPS.filter((group) => group.id === groupFilter)),
    [groupFilter],
  );

  const selected = useMemo(
    () => ALL_ENDPOINTS.find((endpoint) => endpoint.id === selectedId) ?? ALL_ENDPOINTS[0],
    [selectedId],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <aside className="lg:col-span-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setGroupFilter("all")}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] transition-colors ${
              groupFilter === "all"
                ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-200"
                : "border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            ALL
          </button>
          {API_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setGroupFilter(group.id)}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] transition-colors ${
                groupFilter === group.id
                  ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-200"
                  : "border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {group.name}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-6">
          {visibleGroups.map((group) => (
            <div key={group.id}>
              <h3 className="flex items-center gap-2 px-1 font-mono text-[11px] font-bold tracking-wider text-slate-300">
                <Server className="size-3.5 text-indigo-300" />
                {group.name}
              </h3>
              <p className="mt-1 px-1 text-[11px] leading-relaxed text-slate-500">
                {group.description}
              </p>
              <ul className="mt-2 space-y-1">
                {group.endpoints.map((endpoint) => {
                  const active = endpoint.id === selectedId;
                  return (
                    <li key={endpoint.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(endpoint.id)}
                        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-right transition-colors ${
                          active
                            ? "border-indigo-400/40 bg-indigo-500/10"
                            : "border-transparent hover:border-slate-800 hover:bg-white/[0.03]"
                        }`}
                      >
                        <span
                          className={`rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold ${METHOD_STYLES[endpoint.method]}`}
                        >
                          {endpoint.method}
                        </span>
                        <span className="truncate font-mono text-[10px] text-slate-400" dir="ltr">
                          {endpoint.path.replace("/api/backend/enterprise-hub", "")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <section className="lg:col-span-8">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${METHOD_STYLES[selected.method]}`}
            >
              {selected.method}
            </span>
            <code className="font-mono text-xs text-slate-200" dir="ltr">
              {selected.path}
            </code>
            <span className="ml-auto flex items-center gap-2">
              {selected.auth && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2 py-1 font-mono text-[10px] text-amber-300">
                  <Lock className="size-3" />
                  AUTH
                </span>
              )}
              <CopyButton value={selected.path} label="COPY" />
            </span>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-400">{selected.summary}</p>

          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div>
              <h4 className="font-mono text-[10px] font-bold tracking-wider text-slate-400">
                REQUEST
              </h4>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {selected.requestExample ?? "(no body)"}
              </pre>
            </div>
            <div>
              <h4 className="font-mono text-[10px] font-bold tracking-wider text-slate-400">
                RESPONSE
              </h4>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {selected.responseExample}
              </pre>
            </div>
          </div>

          <div className="mt-5">
            <TryItPanel key={selected.id} endpoint={selected} />
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-slate-800/80 bg-white/[0.02] p-4 text-[11px] leading-relaxed text-slate-500">
          <BookOpen className="mt-0.5 size-3.5 shrink-0 text-indigo-300" />
          <p>
            مسیرهای <span className="font-mono">/api/backend/*</span> از طریق پروکسی هم‌مبدأ به
            سرویس سازمانی و مسیرهای <span className="font-mono">/api/v1/factory/*</span> به موتور
            کارخانه نرم‌افزار هدایت می‌شوند. برخی اندپوینت‌ها به احراز هویت سازمانی نیاز دارند.
          </p>
        </div>
      </section>
    </div>
  );
}
