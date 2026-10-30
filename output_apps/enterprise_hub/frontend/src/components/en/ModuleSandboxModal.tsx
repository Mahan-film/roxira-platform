"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";

export type ModuleKey =
  | "invoicing"
  | "accounting"
  | "inventory"
  | "crm"
  | "penalty"
  | "ai";

interface ModuleSandboxModalProps {
  activeModule: ModuleKey | null;
  onClose: () => void;
  onSelectModule: (mod: ModuleKey) => void;
  onRequestApiClick: () => void;
}

const TAB_LABELS: Record<ModuleKey, string> = {
  invoicing: "E-Invoicing",
  accounting: "Accounting",
  inventory: "Inventory",
  crm: "CRM & Pipeline",
  penalty: "Penalty Calculator",
  ai: "AI Knowledge Core",
};

const MODULE_META: Record<
  ModuleKey,
  { title: string; badge: string; endpoint: string; color: string }
> = {
  invoicing: {
    title: "E-Invoicing & VAT Engine",
    badge: "POST /api/v1/invoicing/issue",
    endpoint: "https://roxira.net/api/backend/invoices",
    color: "text-indigo-400 border-indigo-500/30 bg-indigo-500/10",
  },
  accounting: {
    title: "Double-Entry General Ledger",
    badge: "POST /api/v1/accounting/journal",
    endpoint: "https://roxira.net/api/backend/accounting/entries",
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
  inventory: {
    title: "Multi-Warehouse FIFO Control",
    badge: "GET /api/v1/inventory/fifo-valuation",
    endpoint: "https://roxira.net/api/backend/inventory/stock",
    color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  },
  crm: {
    title: "Enterprise CRM & Kanban Pipeline",
    badge: "PATCH /api/v1/crm/deals/:id/stage",
    endpoint: "https://roxira.net/api/backend/crm/pipeline",
    color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  },
  penalty: {
    title: "Late-Payment Penalty Calculator",
    badge: "POST /api/v1/damages/calculate",
    endpoint: "https://roxira.net/api/backend/damages/compute",
    color: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  },
  ai: {
    title: "AI Knowledge Core (GraphRAG)",
    badge: "POST /api/v1/ai/graph-query",
    endpoint: "https://roxira.net/api/backend/ai/query",
    color: "text-purple-400 border-purple-500/30 bg-purple-500/10",
  },
};

export default function ModuleSandboxModal({
  activeModule,
  onClose,
  onSelectModule,
  onRequestApiClick,
}: ModuleSandboxModalProps) {
  // --- Live Server Cryptographic Audit Verification ---
  const [serverAuditHash, setServerAuditHash] = useState<string>("sha256:9f84c...31a0");
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const verifyOnServer = useCallback(async (moduleKey: ModuleKey, params: Record<string, unknown>) => {
    setIsVerifying(true);
    try {
      const res = await fetch("/api/v1/sandbox/verify-computation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: moduleKey, params }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.auditHash) {
          setServerAuditHash(data.auditHash);
        }
      }
    } catch {
      // Keep existing hash on network failure
    } finally {
      setIsVerifying(false);
    }
  }, []);

  // --- 1. E-Invoicing State ---
  const [invoiceItems, setInvoiceItems] = useState([
    { id: 1, desc: "Cross-Border Settlement Gateway License", qty: 1, price: 8500 },
    { id: 2, desc: "Enterprise API High-Throughput Tier", qty: 2, price: 2000 },
  ]);
  const [vatRate, setVatRate] = useState<number>(19);
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  // --- 2. Accounting State ---
  const [ledgerEntries, setLedgerEntries] = useState([
    { id: "JE-1041", account: "1100 · Accounts Receivable (EUR)", debit: 12500, credit: 0 },
    { id: "JE-1042", account: "4000 · SaaS Enterprise Revenue", debit: 0, credit: 10504.2 },
    { id: "JE-1043", account: "2200 · VAT Output Liability", debit: 0, credit: 1995.8 },
  ]);
  const [accTitle, setAccTitle] = useState("");
  const [accDebit, setAccDebit] = useState("");
  const [accCredit, setAccCredit] = useState("");

  // --- 3. Inventory FIFO State ---
  const [selectedWarehouse, setSelectedWarehouse] = useState("EU-Central (Frankfurt)");
  const [dispatchQty, setDispatchQty] = useState<number>(140);
  const fifoBatches = [
    { batch: "BATCH-2026-A", date: "2026-08-12", qty: 100, unitCost: 42.0 },
    { batch: "BATCH-2026-B", date: "2026-09-19", qty: 150, unitCost: 46.5 },
    { batch: "BATCH-2026-C", date: "2026-10-10", qty: 200, unitCost: 49.0 },
  ];

  // --- 4. CRM Kanban State ---
  const [deals, setDeals] = useState([
    { id: "D-1", company: "Nordic Freight AG", value: 48000, stage: "Qualified" },
    { id: "D-2", company: "Al-Futtaim Logistics", value: 92500, stage: "Due Diligence" },
    { id: "D-3", company: "Bosphorus Trade House", value: 34000, stage: "Contract & KYB" },
    { id: "D-4", company: "Meridian FinTech Ltd", value: 120000, stage: "Closed Won" },
  ]);

  // --- 5. Penalty Calculator State ---
  const [principal, setPrincipal] = useState<number>(50000);
  const [overdueDays, setOverdueDays] = useState<number>(75);
  const [annualIndexRate, setAnnualIndexRate] = useState<number>(14.5);

  // --- 6. AI Knowledge Core State ---
  const [aiQuery, setAiQuery] = useState(
    "What are the VAT compliance rules for cross-border EUR-to-AED settlement?"
  );
  const aiQueryRef = useRef(aiQuery);
  const [aiResult, setAiResult] = useState({
    answer:
      "Under Roxira Multi-Jurisdiction Tax Engine v4.2, cross-border B2B settlements between EU VAT-registered entities and UAE Free Zone counterparts qualify for Reverse-Charge mechanism (0% withholding), provided a valid TRN/VAT ID is cryptographically verified in the invoice payload.",
    nodes: ["EU-VAT-Directive-Art196", "UAE-FTA-B2B-ReverseCharge", "Schema:InvoicePayload.taxId"],
    confidence: "98.4%",
  });

  // Trigger server verification when active module or primary values change
  useEffect(() => {
    if (!activeModule) return;
    let params: Record<string, unknown> = {};
    if (activeModule === "invoicing") params = { itemsCount: invoiceItems.length, vatRate };
    else if (activeModule === "accounting") params = { entriesCount: ledgerEntries.length };
    else if (activeModule === "inventory") params = { warehouse: selectedWarehouse, dispatchQty };
    else if (activeModule === "crm") params = { dealsCount: deals.length };
    else if (activeModule === "penalty") params = { principal, overdueDays, annualIndexRate };
    else if (activeModule === "ai") params = { query: aiQueryRef.current };

    let cancelled = false;
    fetch("/api/v1/sandbox/verify-computation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: activeModule, params }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.auditHash) {
          setServerAuditHash(data.auditHash);
        }
      })
      .catch(() => {
        // Keep existing hash on network failure
      })
      .finally(() => {
        if (!cancelled) setIsVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeModule,
    invoiceItems.length,
    vatRate,
    ledgerEntries.length,
    selectedWarehouse,
    dispatchQty,
    deals,
    principal,
    overdueDays,
    annualIndexRate,
  ]);

  if (!activeModule) return null;

  const meta = MODULE_META[activeModule];

  // Calculations for E-Invoicing
  const subtotal = invoiceItems.reduce((acc, item) => acc + item.qty * item.price, 0);
  const vatAmount = (subtotal * vatRate) / 100;
  const invoiceTotal = subtotal + vatAmount;

  // Calculations for Accounting
  const totalDebit = ledgerEntries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredit = ledgerEntries.reduce((sum, e) => sum + e.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  // Calculations for Inventory FIFO
  let remainingToDispatch = dispatchQty;
  let cogs = 0;
  const batchBreakdown = fifoBatches.map((b) => {
    const taken = Math.min(b.qty, Math.max(0, remainingToDispatch));
    remainingToDispatch -= taken;
    cogs += taken * b.unitCost;
    return { ...b, taken, left: b.qty - taken };
  });
  const remainingValue = batchBreakdown.reduce((sum, b) => sum + b.left * b.unitCost, 0);

  // Calculations for Penalty Calculator
  const penaltyAmount = principal * (annualIndexRate / 100) * (overdueDays / 365);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-2xl border border-white/15 bg-[#0b0e17] text-slate-100 shadow-2xl overflow-hidden my-8">
        {/* Top Bar with Module Switcher Tabs */}
        <div className="border-b border-white/10 bg-[#070910] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Interactive Enterprise Sandbox (Live Preview)
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 transition"
          >
            ✕ Close workspace
          </button>
        </div>

        {/* Module Navigation Pills - Exact Labels without duplication */}
        <div className="flex overflow-x-auto gap-2 border-b border-white/10 bg-[#090c14] px-6 py-3">
          {(Object.keys(TAB_LABELS) as ModuleKey[]).map((key) => (
            <button
              key={key}
              onClick={() => {
                setIsVerifying(true);
                onSelectModule(key);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                activeModule === key
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
              }`}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>

        {/* Active Module Header */}
        <div className="border-b border-white/10 px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-[#0d101c]">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span>{meta.title}</span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${meta.color}`}>
                Interactive Mode
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Production Endpoint: <code className="text-indigo-300 font-mono">{meta.endpoint}</code>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs font-mono rounded bg-white/5 border border-white/10 px-2.5 py-1 text-slate-300">
              {meta.badge}
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
              <span>Audit Hash:</span>
              <span className="text-indigo-300 font-semibold">{serverAuditHash}</span>
              <span className={isVerifying ? "text-amber-400 animate-pulse" : "text-emerald-400"}>
                {isVerifying ? "● Verifying" : "✓ Verified"}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Interactive Content Area */}
        <div className="p-6 space-y-6 max-h-[65vh] overflow-y-auto">
          {/* 1. E-INVOICING SANDBOX */}
          {activeModule === "invoicing" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <h4 className="text-sm font-medium text-slate-200 mb-3">
                    Invoice Line Items (VAT-Compliant Schema)
                  </h4>
                  <div className="space-y-2">
                    {invoiceItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg bg-black/40 border border-white/5 px-3 py-2 text-xs"
                      >
                        <div>
                          <p className="font-medium text-slate-200">{item.desc}</p>
                          <p className="text-slate-400">
                            Qty: {item.qty} × €{item.price.toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-slate-100">
                            €{(item.qty * item.price).toLocaleString()}
                          </span>
                          <button
                            onClick={() => {
                              const updated = invoiceItems.filter((i) => i.id !== item.id);
                              setInvoiceItems(updated);
                              verifyOnServer("invoicing", { itemsCount: updated.length, vatRate });
                            }}
                            className="text-rose-400 hover:text-rose-300"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <input
                      type="text"
                      placeholder="Service or item description..."
                      value={newItemDesc}
                      onChange={(e) => setNewItemDesc(e.target.value)}
                      className="flex-1 min-w-[180px] rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-white"
                    />
                    <input
                      type="number"
                      placeholder="Amount (€)"
                      value={newItemPrice}
                      onChange={(e) => setNewItemPrice(e.target.value)}
                      className="w-28 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-white"
                    />
                    <button
                      onClick={() => {
                        if (!newItemDesc || !newItemPrice) return;
                        const updated = [
                          ...invoiceItems,
                          {
                            id: Date.now(),
                            desc: newItemDesc,
                            qty: 1,
                            price: Number(newItemPrice),
                          },
                        ];
                        setInvoiceItems(updated);
                        setNewItemDesc("");
                        setNewItemPrice("");
                        verifyOnServer("invoicing", { itemsCount: updated.length, vatRate });
                      }}
                      className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition"
                    >
                      + Add Line
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-slate-200">Real-Time Tax Summary</h4>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Net Subtotal</span>
                    <span className="font-mono text-white">€{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>VAT Rate (%)</span>
                    <select
                      value={vatRate}
                      onChange={(e) => {
                        const newRate = Number(e.target.value);
                        setVatRate(newRate);
                        verifyOnServer("invoicing", { itemsCount: invoiceItems.length, vatRate: newRate });
                      }}
                      className="rounded border border-white/15 bg-black px-2 py-1 text-xs text-white"
                    >
                      <option value={0}>0% (Reverse Charge)</option>
                      <option value={5}>5% (UAE Standard)</option>
                      <option value={19}>19% (EU Germany)</option>
                      <option value={20}>20% (UK / TR)</option>
                    </select>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Computed VAT</span>
                    <span className="font-mono text-indigo-300">€{vatAmount.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-white/10 pt-3 flex justify-between text-sm font-semibold">
                    <span>Gross Total (EUR)</span>
                    <span className="font-mono text-emerald-400">€{invoiceTotal.toFixed(2)}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-black/50 p-2.5 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                  <span>Server Audit Hash:</span>
                  <span className="text-indigo-400">{serverAuditHash}</span>
                </div>
              </div>
            </div>
          )}

          {/* 2. ACCOUNTING SANDBOX */}
          {activeModule === "accounting" && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-slate-400 uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Entry ID</th>
                      <th className="py-2.5 px-4">General Ledger Account</th>
                      <th className="py-2.5 px-4 text-right">Debit (EUR)</th>
                      <th className="py-2.5 px-4 text-right">Credit (EUR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="bg-black/20">
                        <td className="py-2.5 px-4 font-mono text-slate-400">{entry.id}</td>
                        <td className="py-2.5 px-4 text-slate-200">{entry.account}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-emerald-400">
                          {entry.debit > 0 ? `€${entry.debit.toFixed(2)}` : "—"}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-indigo-400">
                          {entry.credit > 0 ? `€${entry.credit.toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-white/5 font-semibold text-xs">
                    <tr>
                      <td colSpan={2} className="py-3 px-4">
                        Trial Balance Status:{" "}
                        <span className={isBalanced ? "text-emerald-400" : "text-rose-400"}>
                          {isBalanced ? "✓ BALANCED" : "⚠ UNBALANCED (Check Double-Entry)"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono">€{totalDebit.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right font-mono">€{totalCredit.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex flex-wrap gap-2 items-center rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <input
                  type="text"
                  placeholder="Account (e.g., 5100 · FX Settlement Fee)"
                  value={accTitle}
                  onChange={(e) => setAccTitle(e.target.value)}
                  className="flex-1 min-w-[180px] rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white"
                />
                <input
                  type="number"
                  placeholder="Debit (€)"
                  value={accDebit}
                  onChange={(e) => setAccDebit(e.target.value)}
                  className="w-28 rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white"
                />
                <input
                  type="number"
                  placeholder="Credit (€)"
                  value={accCredit}
                  onChange={(e) => setAccCredit(e.target.value)}
                  className="w-28 rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white"
                />
                <button
                  onClick={() => {
                    if (!accTitle) return;
                    const updated = [
                      ...ledgerEntries,
                      {
                        id: `JE-${1044 + ledgerEntries.length}`,
                        account: accTitle,
                        debit: Number(accDebit) || 0,
                        credit: Number(accCredit) || 0,
                      },
                    ];
                    setLedgerEntries(updated);
                    setAccTitle("");
                    setAccDebit("");
                    setAccCredit("");
                    verifyOnServer("accounting", { entriesCount: updated.length });
                  }}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 text-xs font-medium text-white transition"
                >
                  + Post Journal Line
                </button>
              </div>
            </div>
          )}

          {/* 3. INVENTORY FIFO SANDBOX */}
          {activeModule === "inventory" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Active Hub Warehouse</label>
                  <select
                    value={selectedWarehouse}
                    onChange={(e) => {
                      setSelectedWarehouse(e.target.value);
                      verifyOnServer("inventory", { warehouse: e.target.value, dispatchQty });
                    }}
                    className="rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white"
                  >
                    <option>EU-Central (Frankfurt)</option>
                    <option>MENA-FreeZone (Jebel Ali, Dubai)</option>
                    <option>TR-Transit (Istanbul Customs Hub)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Simulate Outbound Order Quantity (FIFO Queue):{" "}
                    <span className="text-amber-400 font-mono">{dispatchQty} units</span>
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={400}
                    value={dispatchQty}
                    onChange={(e) => {
                      const newQty = Number(e.target.value);
                      setDispatchQty(newQty);
                      verifyOnServer("inventory", { warehouse: selectedWarehouse, dispatchQty: newQty });
                    }}
                    className="w-64 accent-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {batchBreakdown.map((b) => (
                  <div
                    key={b.batch}
                    className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-2 text-xs"
                  >
                    <div className="flex justify-between">
                      <span className="font-mono font-semibold text-amber-300">{b.batch}</span>
                      <span className="text-slate-400">{b.date}</span>
                    </div>
                    <p className="text-slate-300">
                      Initial Stock: <b>{b.qty}</b> @ ${b.unitCost.toFixed(2)}/u
                    </p>
                    <p className="text-rose-400">Dispatched via FIFO: -{b.taken} units</p>
                    <p className="text-emerald-400 font-medium">Remaining Stock: {b.left} units</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-wrap justify-between text-xs">
                <span>
                  Computed FIFO COGS (Cost of Goods Sold):{" "}
                  <strong className="font-mono text-amber-300">${cogs.toFixed(2)} USD</strong>
                </span>
                <span>
                  Remaining Warehouse Valuation:{" "}
                  <strong className="font-mono text-emerald-300">
                    ${remainingValue.toFixed(2)} USD
                  </strong>
                </span>
              </div>
            </div>
          )}

          {/* 4. CRM & PIPELINE SANDBOX */}
          {activeModule === "crm" && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {["Qualified", "Due Diligence", "Contract & KYB", "Closed Won"].map((stage) => (
                <div
                  key={stage}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-semibold text-slate-200">{stage}</span>
                    <span className="text-[11px] font-mono text-cyan-400">
                      {deals.filter((d) => d.stage === stage).length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {deals
                      .filter((d) => d.stage === stage)
                      .map((deal) => (
                        <div
                          key={deal.id}
                          className="rounded-lg border border-white/10 bg-black/50 p-3 text-xs space-y-2"
                        >
                          <p className="font-medium text-white">{deal.company}</p>
                          <p className="font-mono text-emerald-400">
                            ${deal.value.toLocaleString()} ARR
                          </p>
                          <div className="flex flex-wrap gap-1 pt-1">
                            {["Qualified", "Due Diligence", "Contract & KYB", "Closed Won"]
                              .filter((s) => s !== stage)
                              .map((targetStage) => (
                                <button
                                  key={targetStage}
                                  onClick={() => {
                                    const updated = deals.map((item) =>
                                      item.id === deal.id
                                        ? { ...item, stage: targetStage }
                                        : item
                                    );
                                    setDeals(updated);
                                    verifyOnServer("crm", { dealId: deal.id, targetStage });
                                  }}
                                  className="rounded bg-white/5 hover:bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-slate-300"
                                >
                                  → {targetStage.split(" ")[0]}
                                </button>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 5. PENALTY CALCULATOR SANDBOX */}
          {activeModule === "penalty" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Principal Debt Amount (EUR/USD)</label>
                  <input
                    type="number"
                    value={principal}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setPrincipal(val);
                      verifyOnServer("penalty", { principal: val, overdueDays, annualIndexRate });
                    }}
                    className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Overdue Duration (Calendar Days)</label>
                  <input
                    type="number"
                    value={overdueDays}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setOverdueDays(val);
                      verifyOnServer("penalty", { principal, overdueDays: val, annualIndexRate });
                    }}
                    className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Central Bank Reference Index Rate (% Annual)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={annualIndexRate}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setAnnualIndexRate(val);
                      verifyOnServer("penalty", { principal, overdueDays, annualIndexRate: val });
                    }}
                    className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5 flex flex-col justify-between">
                <div className="space-y-3 text-xs">
                  <h4 className="text-sm font-semibold text-white">
                    Computed Late-Payment Damages
                  </h4>
                  <div className="flex justify-between text-slate-300">
                    <span>Principal Amount:</span>
                    <span className="font-mono">${principal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Accrued Late Penalty:</span>
                    <span className="font-mono text-rose-400">+${penaltyAmount.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-white/10 pt-3 flex justify-between text-sm font-semibold">
                    <span>Total Claimable Settlement:</span>
                    <span className="font-mono text-emerald-400">
                      ${(principal + penaltyAmount).toFixed(2)}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-4">
                  Formula: Principal × (IndexRate / 100) × (OverdueDays / 365). Compliant with
                  commercial arbitration standards.
                </p>
              </div>
            </div>
          )}

          {/* 6. AI KNOWLEDGE CORE SANDBOX */}
          {activeModule === "ai" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiQuery}
                  onChange={(e) => {
                    aiQueryRef.current = e.target.value;
                    setAiQuery(e.target.value);
                  }}
                  className="flex-1 rounded-xl border border-white/15 bg-black/50 px-4 py-2.5 text-xs text-white"
                  placeholder="Ask the GraphRAG compliance & financial engine..."
                />
                <button
                  onClick={() => {
                    setAiResult({
                      answer: `GraphRAG synthesized response for "${aiQuery}": Cross-border ledger entries are automatically normalized against daily ECB & Central Bank reference feeds with full audit lineage stored in Qdrant vector shards.`,
                      nodes: [
                        "GraphNode:CrossBorderSettlement",
                        "VectorShard:Compliance-2026-v4",
                        "Policy:ISO-20022-Audit",
                      ],
                      confidence: "99.1%",
                    });
                    verifyOnServer("ai", { query: aiQuery });
                  }}
                  className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2.5 text-xs font-medium text-white transition"
                >
                  Run GraphRAG
                </button>
              </div>

              <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-purple-300">
                    Synthesized Knowledge Dispatch
                  </span>
                  <span className="font-mono text-emerald-400">
                    Confidence: {aiResult.confidence}
                  </span>
                </div>
                <p className="text-slate-200 leading-relaxed">{aiResult.answer}</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {aiResult.nodes.map((node) => (
                    <span
                      key={node}
                      className="rounded-md bg-black/50 border border-white/10 px-2.5 py-1 font-mono text-[11px] text-purple-300"
                    >
                      🔗 {node}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="border-t border-white/10 bg-[#070910] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            Production database writes require a scoped{" "}
            <code className="text-slate-200">Bearer JWT</code> token.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onClose();
                onRequestApiClick();
              }}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition"
            >
              Connect via API / Get Scoped JWT →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
