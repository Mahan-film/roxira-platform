"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Download, Loader2, Upload } from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAccounts } from "@/lib/api/accounting-client";
import {
  answerCheck,
  answerQuestion,
  approveDrafts,
  buildReport,
  commitSession,
  createAccountFromSession,
  decideMatch,
  downloadReport,
  getReconSettings,
  getReview,
  getSession,
  listSessions,
  rejectDraft,
  rerunSession,
  submitMapping,
  updateReconSettings,
  uploadStatement,
  type ReconCheck,
  type ReconReport,
  type ReconReview,
  type ReconSession,
  type ReconSettings,
} from "@/lib/api/bank-recon-client";
import { formatJalaliDate } from "@/lib/fa-format";
import type { ChartOfAccount } from "@/types/accounting";

/** Rial amounts arrive as digit strings (BIGINT): grouped as text, never through Number. */
const rial = (value: string) => `${value.replace(/\B(?=(\d{3})+(?!\d))/g, "٬")} ریال`;

const CATEGORY_LABEL: Record<string, string> = {
  bank_fee: "کارمزد بانکی",
  sms_fee: "هزینه پیامک",
  sale: "فروش",
  purchase: "خرید",
  partner_current: "جاری شریک",
  payroll: "حقوق",
  loan: "وام",
  tax: "مالیات",
  own_transfer: "انتقال داخلی",
};

const FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "date", label: "تاریخ", required: true },
  { key: "description", label: "شرح" },
  { key: "amount", label: "مبلغ (ستون واحد)" },
  { key: "withdrawal", label: "برداشت" },
  { key: "deposit", label: "واریز" },
  { key: "balance", label: "مانده" },
  { key: "reference", label: "شماره پیگیری" },
];

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function AccountSelect({
  accounts,
  value,
  onChange,
  label,
  byCode,
}: {
  accounts: ChartOfAccount[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  byCode?: boolean;
}) {
  return (
    <select aria-label={label} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {accounts.map((a) => (
        <option key={a.id} value={byCode ? a.code : String(a.id)}>
          {a.code} — {a.name}
        </option>
      ))}
    </select>
  );
}

function CheckRow({ check, busy, onAnswer }: { check: ReconCheck; busy: boolean; onAnswer: (choice: string) => void }) {
  const icon: Record<ReconCheck["severity"], ReactNode> = {
    ok: <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />,
    warn: <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />,
    ask: <CircleHelp className="size-4 text-indigo-600" aria-hidden="true" />,
    block: <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />,
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="flex items-start gap-2 text-sm font-medium">
        <span className="mt-0.5 shrink-0">{icon[check.severity]}</span>
        {check.message}
      </p>
      {check.evidence.length > 0 && (
        <ul className="list-disc ps-6 text-xs text-muted-foreground">
          {check.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {check.choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {check.choices.map((choice) => (
            <Button key={choice.id} size="sm" variant="outline" disabled={busy} onClick={() => onAnswer(choice.id)}>
              {choice.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function MappingForm({
  session,
  busy,
  onSubmit,
}: {
  session: ReconSession;
  busy: boolean;
  onSubmit: (map: Record<string, number>) => void;
}) {
  const mapping = session.mapping;
  const [map, setMap] = useState<Record<string, number>>(mapping?.suggestedMap ?? {});
  if (!mapping) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ستون‌های این فایل را مشخص کنید</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{mapping.reason}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <Label htmlFor={`map-${field.key}`}>{field.label}</Label>
              <select
                id={`map-${field.key}`}
                className={selectClass}
                value={map[field.key] ?? ""}
                onChange={(e) => {
                  const next = { ...map };
                  if (e.target.value === "") delete next[field.key];
                  else next[field.key] = Number(e.target.value);
                  setMap(next);
                }}
              >
                <option value="">انتخاب نشده</option>
                {mapping.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={index}>
                    {header || `ستون ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <Button className="w-fit" disabled={busy || map.date === undefined} onClick={() => onSubmit(map)}>
          ادامه
        </Button>
      </CardContent>
    </Card>
  );
}

function CreateAccountForm({
  accounts,
  busy,
  onCreate,
}: {
  accounts: ChartOfAccount[];
  busy: boolean;
  onCreate: (name: string, ledgerAccountId: number) => void;
}) {
  const [name, setName] = useState("");
  const [ledger, setLedger] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">این حساب بانکی هنوز تعریف نشده است</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          شماره حساب و شبا از خود فایل خوانده می‌شود؛ فقط نام و حساب معین دفتر را مشخص کنید.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-account-name">نام حساب</Label>
            <Input id="new-account-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-account-ledger">حساب دفتر کل</Label>
            <AccountSelect accounts={accounts} value={ledger} onChange={setLedger} label="انتخاب حساب" />
          </div>
        </div>
        <Button className="w-fit" disabled={busy || !name.trim() || !ledger} onClick={() => onCreate(name.trim(), Number(ledger))}>
          ساخت حساب و ادامه
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ accounts }: { accounts: ChartOfAccount[] }) {
  const [settings, setSettings] = useState<ReconSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getReconSettings().then(setSettings).catch((e: unknown) => setError(loadErrorMessage(e)));
  }, []);

  if (!settings) return <ErrorNotice title="خطا در تنظیمات" message={error} />;
  const feeAccount = settings.categoryAccounts.bank_fee ?? "";
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      setSettings(
        await updateReconSettings({
          feeMaxRial: settings.feeMaxRial,
          smsFeeMaxRial: settings.smsFeeMaxRial,
          autoPostFees: settings.autoPostFees,
          categoryAccounts: settings.categoryAccounts,
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(loadErrorMessage(e));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">تنظیمات کارمزد</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ErrorNotice title="خطا در ذخیره" message={error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="fee-max">سقف کارمزد (ریال)</Label>
            <Input id="fee-max" dir="ltr" inputMode="numeric" value={settings.feeMaxRial} onChange={(e) => setSettings({ ...settings, feeMaxRial: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="sms-max">سقف هزینه پیامک (ریال)</Label>
            <Input id="sms-max" dir="ltr" inputMode="numeric" value={settings.smsFeeMaxRial} onChange={(e) => setSettings({ ...settings, smsFeeMaxRial: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fee-account">حساب هزینه کارمزد</Label>
            <AccountSelect
              accounts={accounts}
              byCode
              label="انتخاب حساب"
              value={feeAccount}
              onChange={(code) => {
                const next = { ...settings.categoryAccounts };
                if (code) {
                  next.bank_fee = code;
                  next.sms_fee = next.sms_fee ?? code;
                } else {
                  delete next.bank_fee;
                }
                setSettings({ ...settings, categoryAccounts: next });
              }}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.autoPostFees}
            onChange={(e) => setSettings({ ...settings, autoPostFees: e.target.checked })}
          />
          کارمزدهای کوچکِ شناسایی‌شده بدون تأیید ثبت شوند
        </label>
        <div className="flex items-center gap-3">
          <Button size="sm" className="w-fit" onClick={save}>
            ذخیره
          </Button>
          {saved && <span className="text-sm text-emerald-700">ذخیره شد.</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export function BankReconWizard() {
  const { can } = useAccess();
  const canPost = can("banking", "post");
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [sessions, setSessions] = useState<ReconSession[]>([]);
  const [session, setSession] = useState<ReconSession | null>(null);
  const [review, setReview] = useState<ReconReview | null>(null);
  const [report, setReport] = useState<ReconReport | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [counterAccounts, setCounterAccounts] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(loadErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    listAccounts().then(setAccounts).catch((e: unknown) => setError(loadErrorMessage(e)));
    listSessions().then(setSessions).catch((e: unknown) => setError(loadErrorMessage(e)));
  }, []);

  const applySession = (next: ReconSession) => {
    setSession(next);
    setReview(null);
    setReport(null);
  };

  const applyReview = (next: ReconReview) => {
    setReview(next);
    setSession(next.session);
    setSelected(new Set(next.drafts.filter((d) => d.status === "draft").map((d) => d.id)));
  };

  const open = (id: number, status: string) =>
    run(async () => {
      if (status === "committed" || status === "closed") applyReview(await getReview(id));
      else applySession(await getSession(id));
    });

  const download = (reportId: number, format: "xlsx" | "csv" | "html") =>
    run(async () => {
      const url = URL.createObjectURL(await downloadReport(reportId, format));
      const link = document.createElement("a");
      link.href = url;
      link.download = `reconciliation-${reportId}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    });

  const isOpen = session && session.status !== "committed" && session.status !== "closed";
  const questions = review?.questions.filter((q) => !skipped.has(q.itemId)) ?? [];
  const needAccount = review?.unmatched.filter((i) => i.needsAccount) ?? [];
  const drafts = review?.drafts.filter((d) => d.status === "draft") ?? [];
  const failed = review?.drafts.filter((d) => d.status === "failed") ?? [];

  return (
    <div className="flex flex-col gap-4">
      <ErrorNotice title="انجام نشد" message={error} />
      {notice && <p className="rounded-md border border-emerald-300 p-3 text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}

      {!session && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">۱. بارگذاری صورتحساب</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                فایل Excel، CSV یا PDF متنی بانک را انتخاب کنید. حساب، دوره و مانده از خود فایل خوانده می‌شود.
              </p>
              <Label htmlFor="statement-file" className="flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
                انتخاب فایل
              </Label>
              <input
                id="statement-file"
                type="file"
                className="sr-only"
                disabled={busy}
                accept=".xlsx,.xls,.csv,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void run(async () => applySession(await uploadStatement(file)));
                }}
              />
            </CardContent>
          </Card>
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">صورتحساب‌های قبلی</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-start text-sm hover:bg-muted"
                    onClick={() => void open(s.id, s.status)}
                  >
                    <span className="min-w-0 truncate">{s.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.period ? `${formatJalaliDate(s.period.from)} تا ${formatJalaliDate(s.period.to)}` : s.status}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
          {can("banking", "admin") && <SettingsCard accounts={accounts} />}
        </>
      )}

      {session && isOpen && (
        <>
          {session.status === "needs_mapping" && (
            <MappingForm
              key={session.id}
              session={session}
              busy={busy}
              onSubmit={(map) => void run(async () => applySession(await submitMapping(session.id, map)))}
            />
          )}
          {session.checks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">۲. بررسی پیش‌نیازها: {session.fileName}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {session.checks.map((check) => (
                    <CheckRow
                      key={check.code}
                      check={check}
                      busy={busy}
                      onAnswer={(choice) => void run(async () => applySession(await answerCheck(session.id, check.code, choice)))}
                    />
                  ))}
                </ul>
                {session.skippedRows && session.skippedRows.length > 0 && (
                  <p className="mt-3 text-sm text-amber-700">
                    {session.skippedRows.length} ردیف خوانده نشد و وارد نمی‌شود.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {session.offerCreateAccount && (
            <CreateAccountForm
              accounts={accounts}
              busy={busy}
              onCreate={(name, ledgerId) => void run(async () => applySession(await createAccountFromSession(session.id, name, ledgerId)))}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || session.status !== "ready"}
              onClick={() => void run(async () => applyReview(await commitSession(session.id)))}
            >
              ثبت ردیف‌ها و تطبیق با دفتر
            </Button>
            <Button variant="outline" onClick={() => setSession(null)}>
              بازگشت
            </Button>
          </div>
        </>
      )}

      {session && !isOpen && !review && (
        <Button variant="outline" className="w-fit" onClick={() => void open(session.id, session.status)}>
          نمایش نتیجه
        </Button>
      )}

      {review && session && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["تطبیق‌خورده", review.counts.matched],
              ["پیشنهادی", review.counts.suggested],
              ["بدون تطبیق", review.counts.unmatched],
              ["پیش‌نویس سند", review.counts.drafts],
            ].map(([label, count]) => (
              <Card key={label}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{count}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {questions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">۳. پرسش‌ها ({questions.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {questions.map((q) => (
                  <div key={`${q.kind}-${q.itemId}-${q.groupId ?? ""}`} className="flex flex-col gap-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">{q.text}</p>
                    <ul className="list-disc ps-6 text-xs text-muted-foreground">
                      {q.evidence.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    {q.kind === "classify" && (
                      <AccountSelect
                        accounts={accounts}
                        byCode
                        label="حساب مقابل (در صورت نیاز)"
                        value={counterAccounts[q.itemId] ?? ""}
                        onChange={(code) => setCounterAccounts({ ...counterAccounts, [q.itemId]: code })}
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {q.choices.map((choice) => (
                        <Button
                          key={choice.id}
                          size="sm"
                          variant="outline"
                          disabled={busy || (q.kind === "confirm_match" && !canPost)}
                          onClick={() =>
                            void run(async () => {
                              if (q.kind === "confirm_match" && q.groupId) {
                                applyReview(await decideMatch(session.id, q.groupId, choice.id === "yes"));
                              } else if (choice.id === "skip") {
                                setSkipped(new Set(skipped).add(q.itemId));
                              } else {
                                await answerQuestion(q.itemId, {
                                  choiceId: choice.id,
                                  counterAccountCode: counterAccounts[q.itemId] || undefined,
                                });
                                applyReview(await getReview(session.id));
                              }
                            })
                          }
                        >
                          {choice.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {needAccount.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">حساب مقابل این ردیف‌ها را انتخاب کنید</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {needAccount.map((item) => (
                  <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="min-w-0 text-sm">
                      {item.description} — {rial(item.withdrawalRial === "0" ? item.depositRial : item.withdrawalRial)}
                      <Badge variant="secondary" className="ms-2">
                        {CATEGORY_LABEL[item.category ?? ""] ?? item.category}
                      </Badge>
                    </p>
                    <div className="w-full sm:w-64">
                      <AccountSelect
                        accounts={accounts}
                        byCode
                        label="انتخاب حساب"
                        value=""
                        onChange={(code) => {
                          if (!code || !item.category) return;
                          void run(async () => {
                            await answerQuestion(item.id, { choiceId: item.category as string, counterAccountCode: code });
                            applyReview(await getReview(session.id));
                          });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {drafts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">۴. پیش‌نویس سندها</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {drafts.map((draft) => (
                  <div key={draft.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`انتخاب سند ${draft.description}`}
                      checked={selected.has(draft.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(draft.id);
                        else next.delete(draft.id);
                        setSelected(next);
                      }}
                    />
                    <span className="min-w-0 flex-1">{draft.description}</span>
                    <Badge variant="secondary">{CATEGORY_LABEL[draft.category] ?? draft.category}</Badge>
                    <span dir="ltr">{draft.counterAccountCode}</span>
                    <span>{rial(draft.amountRial)}</span>
                    {canPost && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await rejectDraft(draft.id);
                            applyReview(await getReview(session.id));
                          })
                        }
                      >
                        رد
                      </Button>
                    )}
                  </div>
                ))}
                {canPost ? (
                  <Button
                    className="w-fit"
                    disabled={busy || selected.size === 0}
                    onClick={() =>
                      void run(async () => {
                        const results = await approveDrafts([...selected]);
                        const posted = results.filter((r) => r.status === "posted").length;
                        applyReview(await getReview(session.id));
                        setNotice(`${posted} سند از ${results.length} سند ثبت شد.`);
                      })
                    }
                  >
                    تأیید و ثبت {selected.size} سند
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">ثبت سند به دسترسی «ثبت» در بانک نیاز دارد.</p>
                )}
              </CardContent>
            </Card>
          )}

          {failed.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">سندهای ثبت‌نشده</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {failed.map((draft) => (
                  <p key={draft.id}>
                    {draft.description}: {draft.failureReason}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canPost && (
              <Button variant="outline" disabled={busy} onClick={() => void run(async () => applyReview(await rerunSession(session.id)))}>
                تطبیق دوباره
              </Button>
            )}
            <Button disabled={busy} onClick={() => void run(async () => setReport(await buildReport(session.id)))}>
              ساخت صورت مغایرت
            </Button>
            <Button variant="outline" onClick={() => { setSession(null); setReview(null); setReport(null); void listSessions().then(setSessions); }}>
              صورتحساب دیگر
            </Button>
          </div>

          {report && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">صورت مغایرت آماده است</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                {report.report.difference !== undefined && (
                  <p className="w-full text-sm">اختلاف: {report.report.difference}</p>
                )}
                {(["xlsx", "csv", "html"] as const).map((format) => (
                  <Button key={format} size="sm" variant="outline" onClick={() => void download(report.id, format)}>
                    <Download aria-hidden="true" />
                    {format.toUpperCase()}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
