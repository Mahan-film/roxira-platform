"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileWarning,
  Fingerprint,
  Gauge,
  ListChecks,
  Loader2,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  RetrialEvalResponse,
  RetrialType,
  retrialEvaluate,
} from "@/lib/api/smart-judge-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const RETRIAL_OPTIONS: { value: RetrialType; label: string; hint: string }[] = [
  {
    value: "CRIMINAL_474",
    label: "ماده ۴۷۴ کیفری",
    hint: "جهات هفت‌گانه اعاده دادرسی کیفری",
  },
  {
    value: "CIVIL_426",
    label: "ماده ۴۲۶ حقوقی",
    hint: "جهات اعاده دادرسی مدنی",
  },
  {
    value: "SPECIAL_477",
    label: "ماده ۴۷۷ خاص",
    hint: "خلاف بیّن شرع — دستور رئیس قوه",
  },
];

function scoreTone(score: number): { bar: string; text: string; label: string } {
  if (score >= 70) return { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "شانس پذیرش بالا" };
  if (score >= 40) return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "شانس پذیرش متوسط" };
  return { bar: "bg-red-500", text: "text-red-600 dark:text-red-400", label: "شانس پذیرش پایین" };
}

export function RetrialPanel() {
  const [retrialType, setRetrialType] = useState<RetrialType>("CRIMINAL_474");
  const [caseDescription, setCaseDescription] = useState("");
  const [verdictDetails, setVerdictDetails] = useState("");
  const [userIdentifier, setUserIdentifier] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RetrialEvalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!caseDescription.trim()) {
      setError("شرح ادله جدید و ابطال‌خواهی الزامی است.");
      return;
    }
    if (!userIdentifier.trim()) {
      setError("شناسه کاربر (موبایل یا ایمیل) برای احراز هویت الزامی است.");
      return;
    }
    if (!isVerified) {
      setError("برای سنجش اعاده دادرسی، تأیید احراز هویت با کد یک‌بارمصرف الزامی است.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await retrialEvaluate({
        retrial_type: retrialType,
        case_description: caseDescription.trim(),
        verdict_details: verdictDetails.trim(),
        user_identifier: userIdentifier.trim(),
        is_verified: true,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ارزیابی اعاده دادرسی ناموفق بود.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const tone = result ? scoreTone(result.eligibility_score) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12" dir="rtl">
      <Card className="lg:col-span-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileWarning className="size-5 text-primary" />
            سنجش جهات اعاده دادرسی
          </CardTitle>
          <CardDescription>
            ارزیابی اکید شواهد مکتوم بر مبنای جهات قانونی و انشای دادخواست دیوان عالی کشور
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>جهت قانونی مورد استناد</Label>
              <div className="grid grid-cols-1 gap-2">
                {RETRIAL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRetrialType(option.value)}
                    className={`rounded-lg border px-3 py-2 text-right text-xs transition-all ${
                      retrialType === option.value
                        ? "border-primary bg-primary/10 font-semibold text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <div>{option.label}</div>
                    <div className="mt-0.5 text-[10px] opacity-70">{option.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="retrial-description">شرح ادله جدید و ابطال‌خواهی</Label>
              <Textarea
                id="retrial-description"
                value={caseDescription}
                onChange={(event) => setCaseDescription(event.target.value)}
                placeholder="شواهد مکتوم، اسناد کشف‌شده پس از قطعیت رأی و جهات قانونی مورد ادعا..."
                className="min-h-32"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="retrial-verdict">متن/خلاصه دادنامه واخواهی‌شده (اختیاری)</Label>
              <Textarea
                id="retrial-verdict"
                value={verdictDetails}
                onChange={(event) => setVerdictDetails(event.target.value)}
                placeholder="شماره دادنامه، مرجع صادرکننده، مفاد و تاریخ قطعیت..."
                className="min-h-24"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="retrial-user">شناسه کاربر (موبایل یا ایمیل)</Label>
              <Input
                id="retrial-user"
                value={userIdentifier}
                onChange={(event) => setUserIdentifier(event.target.value)}
                placeholder="09xxxxxxxxx یا name@example.com"
                dir="ltr"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={isVerified}
                onChange={(event) => setIsVerified(event.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              <ShieldCheck className="size-4 text-primary" />
              احراز هویت با کد یک‌بارمصرف (OTP) انجام شده است.
            </label>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  ارزیابی در جریان...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  سنجش شانس پذیرش و انشای دادخواست
                </>
              )}
            </Button>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>خطا در ارزیابی</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6 lg:col-span-7">
        {result ? (
          <>
            <Card className="border-primary/30">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <Gauge className="size-5" />
                    شانس پذیرش اعاده دادرسی
                  </CardTitle>
                  <Badge variant="outline">{result.retrial_label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-end justify-between">
                  <span className={`text-4xl font-black ${tone?.text}`}>
                    {result.eligibility_score}
                    <span className="text-lg">٪</span>
                  </span>
                  <span className={`text-sm font-semibold ${tone?.text}`}>{tone?.label}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${tone?.bar}`}
                    style={{ width: `${result.eligibility_score}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    <Fingerprint className="size-3" />
                    {result.matched_clause || "جهت منطبق یافت نشد"}
                  </Badge>
                  <Badge variant="ghost">
                    سهمیه رایگان باقی‌مانده: {result.quota.remaining} از {result.quota.free_quota}
                  </Badge>
                </div>
                {result.eligibility_analysis && (
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-sm leading-relaxed">
                    {result.eligibility_analysis}
                  </p>
                )}
              </CardContent>
            </Card>

            {result.missing_requirements.length > 0 && (
              <Card className="border-amber-500/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <ListChecks className="size-5" />
                    الزامات تکمیلی پرونده
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-inside list-disc space-y-1.5 text-sm text-muted-foreground">
                    {result.missing_requirements.map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ScrollText className="size-5 text-primary" />
                  ارزیابی حقوقی کامل
                </CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
                {result.legal_evaluation}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-primary" />
                  دادخواست رسمی اعاده دادرسی
                </CardTitle>
              </CardHeader>
              <CardContent>
                {result.petition_text ? (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
                    {result.petition_text}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    با توجه به عدم انطباق کافی ادله با جهات قانونی، دادخواست تولید نشد.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">جهات قانونی احصا‌شده و رویه استنادی</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  {result.statutory_grounds.map((ground, index) => (
                    <li key={`${ground}-${index}`}>{ground}</li>
                  ))}
                </ul>
                {result.cited_precedents.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {result.cited_precedents.map((precedent, index) => (
                      <Badge key={`${precedent}-${index}`} variant="secondary">
                        {precedent}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="flex min-h-[320px] items-center justify-center border-dashed p-8 text-center">
            <div className="space-y-3 text-muted-foreground">
              <Gauge className="mx-auto size-12 text-muted-foreground/40" />
              <p className="text-sm">
                پس از ارائه شواهد مکتوم، امتیاز انطباق با جهات ماده ۴۷۴/۴۲۶ و دادخواست رسمی در این بخش نمایش داده می‌شود.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
