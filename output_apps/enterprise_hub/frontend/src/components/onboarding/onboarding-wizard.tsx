"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Loader2, SkipForward } from "lucide-react";

import { InvitationsPanel } from "@/components/access/invitations-panel";
import { useAccess } from "@/components/app/access-provider";
import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  applyChartTemplate,
  createFiscalYear,
  listChartTemplates,
  listFiscalYears,
} from "@/lib/api/accounting-reports-client";
import { getOnboarding, saveOnboardingProfile, setOnboardingStep } from "@/lib/api/onboarding-client";
import { formatJalaliDate, formatNumber } from "@/lib/fa-format";
import { todayJalaliIso } from "@/lib/jalali-date-input";
import {
  MOADIAN_SETUP_HREF,
  ONBOARDING_STEPS,
  OPENING_BALANCES_HREF,
  STEP_STATUS_LABELS,
  defaultFiscalYear,
  firstPendingStep,
  onboardingCounts,
  profileErrors,
  profilePayload,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import type { ChartTemplate, FiscalYear } from "@/types/accounting-reports";
import type { OnboardingState, OnboardingStepKey, OnboardingStepStatus } from "@/types/onboarding";

/** What every step panel receives from the wizard. */
interface StepProps {
  state: OnboardingState;
  busy: boolean;
  /** Records the step as done/skipped on the server, then moves on to the next step. */
  mark: (status: OnboardingStepStatus) => Promise<void>;
  /** Runs a server call, shows its error and keeps the busy flag. */
  run: (work: () => Promise<unknown>) => Promise<boolean>;
  setState: (next: OnboardingState) => void;
  goNext: () => void;
}

function StepFooter({ state, step, busy, mark, doneLabel, leading, className }: { state: OnboardingState; step: OnboardingStepKey; busy: boolean; mark: StepProps["mark"]; doneLabel?: string; leading?: ReactNode; className?: string }) {
  const status = state.steps[step];
  return (
    <div className={cn("flex flex-wrap items-center gap-2 border-t pt-4", className)}>
      {leading}
      {doneLabel && (
        <Button type="button" disabled={busy} onClick={() => void mark("done")}>
          {doneLabel}
        </Button>
      )}
      <Button type="button" variant="outline" disabled={busy} onClick={() => void mark("skipped")}>
        <SkipForward className="size-4" aria-hidden="true" /> رد کردن این مرحله
      </Button>
      {status !== "pending" && (
        <Badge variant="secondary" data-testid={`step-status-${step}`}>
          {STEP_STATUS_LABELS[status]}
        </Badge>
      )}
    </div>
  );
}

function ProfileStep({ state, busy, mark, run, setState, goNext }: StepProps) {
  const [form, setForm] = useState({
    name: state.companyName,
    economicCode: state.economicCode ?? "",
    nationalId: state.nationalId ?? "",
  });
  const [touched, setTouched] = useState(false);
  const errors = profileErrors(form);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    let saved: OnboardingState | null = null;
    const ok = await run(async () => {
      saved = await saveOnboardingProfile(profilePayload(form));
    });
    if (ok && saved) {
      setState(saved);
      goNext();
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" aria-label="مشخصات شرکت" noValidate>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="onb-name">نام شرکت</Label>
        <Input id="onb-name" value={form.name} maxLength={150} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={touched && Boolean(errors.name)} />
        {touched && errors.name && <p className="text-xs text-rose-400">{errors.name}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="onb-economic">شماره اقتصادی (۱۱ تا ۱۴ رقم)</Label>
        <Input id="onb-economic" dir="ltr" inputMode="numeric" value={form.economicCode} onChange={(e) => setForm({ ...form, economicCode: e.target.value })} aria-invalid={touched && Boolean(errors.economicCode)} />
        {touched && errors.economicCode && <p className="text-xs text-rose-400">{errors.economicCode}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="onb-national">شناسه ملی (۱۰ یا ۱۱ رقم)</Label>
        <Input id="onb-national" dir="ltr" inputMode="numeric" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} aria-invalid={touched && Boolean(errors.nationalId)} />
        {touched && errors.nationalId && <p className="text-xs text-rose-400">{errors.nationalId}</p>}
      </div>
      <StepFooter
        state={state}
        step="profile"
        busy={busy}
        mark={mark}
        className="sm:col-span-2"
        leading={<Button type="submit" disabled={busy}>ذخیره و ادامه</Button>}
      />
    </form>
  );
}

function FiscalYearStep({ state, busy, mark, run }: StepProps) {
  const [years, setYears] = useState<FiscalYear[] | null>(null);
  const [draft, setDraft] = useState(() => defaultFiscalYear(todayJalaliIso()) ?? { name: "", startDate: "", endDate: "" });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listFiscalYears(controller.signal)
      .then(setYears)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const create = async () => {
    let created: FiscalYear[] | null = null;
    const ok = await run(async () => {
      await createFiscalYear(draft);
      created = await listFiscalYears();
    });
    if (ok && created) {
      setYears(created);
      await mark("done");
    }
  };

  return (
    <div className="grid gap-4">
      <ErrorNotice title="دریافت سال‌های مالی انجام نشد" message={loadError} />
      {years === null && !loadError ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <>
          {years && years.length > 0 && (
            <ul className="grid gap-1 text-sm" data-testid="fiscal-year-list">
              {years.map((year) => (
                <li key={year.id}>
                  سال {year.name}: {formatJalaliDate(year.startDate)} تا {formatJalaliDate(year.endDate)}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="onb-year-name">نام سال</Label>
              <Input id="onb-year-name" className="w-28" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="onb-year-start">شروع</Label>
              <JalaliDateInput id="onb-year-start" value={draft.startDate} onChange={(startDate) => setDraft({ ...draft, startDate })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="onb-year-end">پایان</Label>
              <JalaliDateInput id="onb-year-end" value={draft.endDate} onChange={(endDate) => setDraft({ ...draft, endDate })} />
            </div>
            <Button type="button" disabled={busy || !draft.name.trim() || !draft.startDate || !draft.endDate} onClick={() => void create()}>
              تعریف سال مالی
            </Button>
          </div>
        </>
      )}
      <StepFooter state={state} step="fiscal_year" busy={busy} mark={mark} doneLabel={years && years.length > 0 ? "همین سال مالی کافی است" : undefined} />
    </div>
  );
}

function ChartStep({ state, busy, mark, run }: StepProps) {
  const [templates, setTemplates] = useState<ChartTemplate[] | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listChartTemplates(controller.signal)
      .then(setTemplates)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const apply = async (template: ChartTemplate) => {
    let added = 0;
    const ok = await run(async () => {
      added = (await applyChartTemplate(template.key)).added;
    });
    if (ok) {
      setApplied(`قالب «${template.name}» اعمال شد؛ ${formatNumber(added)} حساب افزوده شد.`);
      await mark("done");
    }
  };

  return (
    <div className="grid gap-4">
      <ErrorNotice title="دریافت قالب‌های سرفصل انجام نشد" message={loadError} />
      {templates === null && !loadError ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(templates ?? []).map((template) => (
            <div key={template.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{template.name}</p>
                <p className="text-xs text-muted-foreground">{template.description}</p>
                <p className="text-xs text-muted-foreground">{formatNumber(template.accountCount)} حساب</p>
              </div>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void apply(template)} aria-label={`اعمال قالب ${template.name}`}>
                اعمال
              </Button>
            </div>
          ))}
        </div>
      )}
      {applied && <p role="status" className="text-sm text-emerald-600" data-testid="chart-applied">{applied}</p>}
      <StepFooter state={state} step="chart" busy={busy} mark={mark} />
    </div>
  );
}

function LinkStep({ state, busy, mark, step, text, href, linkLabel, doneLabel }: StepProps & { step: OnboardingStepKey; text: ReactNode; href: string; linkLabel: string; doneLabel: string }) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div>
        <Link href={href} className="inline-flex h-8 items-center rounded-lg bg-indigo-500 px-3 text-sm font-medium text-white hover:bg-indigo-600" data-testid={`link-${step}`}>
          {linkLabel}
        </Link>
      </div>
      <StepFooter state={state} step={step} busy={busy} mark={mark} doneLabel={doneLabel} />
    </div>
  );
}

function UsersStep({ state, busy, mark }: StepProps) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        برای هر همکار نقش مناسب را انتخاب کنید و پیوند دعوت را برایش بفرستید. نقش‌ها و دسترسی‌ها را بعداً در «اعضا و نقش‌ها» هم می‌توانید تغییر دهید.
      </p>
      <InvitationsPanel />
      <StepFooter state={state} step="users" busy={busy} mark={mark} doneLabel="دعوت‌ها انجام شد" />
    </div>
  );
}

/** The wizard: step list on the side, the active step on the main card. Every change is saved on the server. */
export function OnboardingWizard() {
  const { can, loading: accessLoading } = useAccess();
  const [state, setStateRaw] = useState<OnboardingState | null>(null);
  const [active, setActive] = useState<OnboardingStepKey>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getOnboarding(controller.signal)
      .then((loaded) => {
        setStateRaw(loaded);
        setActive(firstPendingStep(loaded) ?? "profile");
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  if (loadError) return <ErrorNotice title="دریافت وضعیت راه‌اندازی انجام نشد" message={loadError} />;
  if (!state || accessLoading) return <Skeleton className="h-64 w-full" />;
  if (!can("members", "admin")) {
    return (
      <p role="alert" className="rounded-xl border border-border p-4 text-sm text-muted-foreground" data-testid="no-access">
        راه‌اندازی شرکت را فقط مالک یا مدیر سازمان می‌تواند انجام دهد.
      </p>
    );
  }

  const counts = onboardingCounts(state);
  const index = ONBOARDING_STEPS.findIndex((s) => s.key === active);
  const info = ONBOARDING_STEPS[index];

  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(loadErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    const next = ONBOARDING_STEPS[index + 1];
    if (next) setActive(next.key);
  };

  const mark = async (status: OnboardingStepStatus) => {
    let updated: OnboardingState | null = null;
    const ok = await run(async () => {
      updated = await setOnboardingStep(active, status);
    });
    if (ok && updated) {
      setStateRaw(updated);
      goNext();
    }
  };

  const props: StepProps = { state, busy, mark, run, setState: setStateRaw, goNext };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]" data-testid="onboarding-wizard">
        <nav aria-label="مراحل راه‌اندازی" className="grid content-start gap-2">
          <p className="text-xs text-muted-foreground" data-testid="onboarding-progress">
            {formatNumber(counts.finished)} از {formatNumber(counts.total)} مرحله انجام یا رد شده است
          </p>
          <ol className="grid gap-1.5">
            {ONBOARDING_STEPS.map((step, i) => {
              const status = state.steps[step.key];
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => setActive(step.key)}
                    aria-current={step.key === active ? "step" : undefined}
                    data-testid={`step-tab-${step.key}`}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl border p-2.5 text-start text-sm transition-colors",
                      step.key === active ? "border-indigo-500/60 bg-indigo-500/10" : "hover:bg-muted/40",
                    )}
                  >
                    {status === "pending" ? (
                      <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className={cn("size-4 shrink-0", status === "done" ? "text-emerald-500" : "text-amber-500")} aria-hidden="true" />
                    )}
                    <span className="flex flex-col">
                      <span className="font-medium">{formatNumber(i + 1)}. {step.title}</span>
                      <span className="text-[11px] text-muted-foreground">{STEP_STATUS_LABELS[status]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <Card>
          <CardHeader>
            <CardTitle>{formatNumber(index + 1)}. {info.title}</CardTitle>
            <CardDescription>{info.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ErrorNotice title="انجام نشد" message={error} />
            {busy && <Loader2 className="size-4 animate-spin" aria-label="در حال انجام" />}
            {active === "profile" && <ProfileStep key="profile" {...props} />}
            {active === "fiscal_year" && <FiscalYearStep key="fiscal_year" {...props} />}
            {active === "chart" && <ChartStep key="chart" {...props} />}
            {active === "opening_balances" && (
              <LinkStep
                {...props}
                step="opening_balances"
                text="مانده‌های اول دوره را از فایل اکسل وارد کنید: در «ورود از اکسل» فایل را رها کنید و نوع داده را «مانده‌های اول دوره حسابداری» بگذارید. پس از ثبت، به همین‌جا برگردید و مرحله را انجام‌شده بزنید."
                href={OPENING_BALANCES_HREF}
                linkLabel="رفتن به ورود از اکسل"
                doneLabel="مانده‌ها را وارد کردم"
              />
            )}
            {active === "users" && <UsersStep {...props} />}
            {active === "moadian" && (
              <LinkStep
                {...props}
                step="moadian"
                text="اتصال به سامانه مودیان (شناسه حافظه مالیاتی، شماره اقتصادی، گواهی و کلید) در صفحهٔ مالیات انجام می‌شود. اطلاعات اتصال همان‌جا و رمزشده نگهداری می‌شود."
                href={MOADIAN_SETUP_HREF}
                linkLabel="رفتن به صفحهٔ مالیات و مودیان"
                doneLabel="اتصال را انجام دادم"
              />
            )}
            {state.completed && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-500/10 p-3 text-sm" role="status" data-testid="onboarding-complete">
                <span>راه‌اندازی تمام شد.</span>
                <Link href="/app" className="font-bold underline">رفتن به داشبورد</Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
