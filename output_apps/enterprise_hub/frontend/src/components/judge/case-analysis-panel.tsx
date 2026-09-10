"use client";

import { useState } from "react";
import {
  AlertCircle,
  BookOpenCheck,
  Gavel,
  Landmark,
  Loader2,
  Network,
  Scale,
  ScrollText,
  Sparkles,
  Wand2,
} from "lucide-react";

import {
  analyzeCase,
  CaseAnalysisResponse,
  JudgeEngineTier,
} from "@/lib/api/smart-judge-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const SAMPLE_CASE =
  "این جانب در تاریخ ۱۴۰۲/۰۳/۱۵ مبلغ ۲,۰۰۰,۰۰۰,۰۰۰ ریال به موجب قرارداد شماره CNT-1402-118 به خوانده واگذار نمودم و مقرر شد تا سررسید ۱۴۰۳/۰۳/۱۵ عین مبلغ مسترد گردد. خوانده با وجود مطالبات مکرر از پرداخت امتناع کرده و چک صیادی شماره ۸۸۴۵۲۱ را نیز در سامانه صیاد ثبت نکرده است. خواسته: مطالبه اصل وجه به همراه خسارت تأخیر تأدیه از تاریخ سررسید تا زمان اجرای حکم.";

const TIER_OPTIONS: { value: JudgeEngineTier; label: string; hint: string }[] = [
  { value: "tier1", label: "سریع", hint: "Gemini / DeepSeek Flash" },
  { value: "tier2", label: "دقت بالا", hint: "GPT-5.6 / DeepSeek Pro" },
  { value: "tier3", label: "تحلیل عمیق", hint: "استدلال حداکثری" },
];

export function CaseAnalysisPanel() {
  const [caseText, setCaseText] = useState("");
  const [tier, setTier] = useState<JudgeEngineTier>("tier2");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CaseAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!caseText.trim()) {
      setError("لطفاً شرح پرونده را وارد کنید.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeCase({ case_text: caseText.trim(), engine_tier: tier });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تحلیل پرونده ناموفق بود.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12" dir="rtl">
      <Card className="lg:col-span-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gavel className="size-5 text-primary" />
            شرح پرونده
          </CardTitle>
          <CardDescription>
            گردش‌کار کامل: ورودی شرح پرونده ← استخراج مواد قانونی ← استدلال قضایی ← لایحه ساختاریافته
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="case-text">متن شرح پرونده / خواسته</Label>
              <Textarea
                id="case-text"
                value={caseText}
                onChange={(event) => setCaseText(event.target.value)}
                placeholder="وقایع، مستندات، طرفین دعوا و خواسته را به‌صورت پیوسته شرح دهید..."
                className="min-h-52"
              />
            </div>

            <div className="space-y-2">
              <Label>سطح موتور تحلیل</Label>
              <div className="flex gap-2">
                {TIER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTier(option.value)}
                    className={`flex-1 rounded-lg border px-2 py-2 text-center text-xs transition-all ${
                      tier === option.value
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

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setCaseText(SAMPLE_CASE)}
                disabled={loading}
              >
                <Wand2 className="size-4" />
                نمونه پرونده
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    تحلیل در جریان...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    تحلیل هوشمند پرونده
                  </>
                )}
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>خطا در تحلیل</AlertTitle>
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
                    <Scale className="size-5" />
                    استدلال قضایی
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{result.tier_label}</Badge>
                    <Badge variant="outline">{result.model_used}</Badge>
                    {result.jurisdiction && (
                      <Badge variant="outline">
                        <Landmark className="size-3" />
                        {result.jurisdiction}
                      </Badge>
                    )}
                  </div>
                </div>
                {result.success_probability && (
                  <CardDescription>ارزیابی شانس موفقیت: {result.success_probability}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
                {result.legal_advisory}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpenCheck className="size-5 text-primary" />
                  مواد قانونی استخراج‌شده
                  <Badge variant="ghost">{result.matched_laws.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.matched_laws.length ? (
                  result.matched_laws.map((law, index) => (
                    <div key={`${law.title}-${index}`} className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{law.title}</span>
                        <Badge variant="outline">{law.category}</Badge>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{law.text}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">ماده قانونی منطبقی یافت نشد.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ScrollText className="size-5 text-primary" />
                  خروجی ساختاریافته لایحه
                </CardTitle>
              </CardHeader>
              <CardContent>
                {result.draft_text ? (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
                    {result.draft_text}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    لایحه‌ای تولید نشد؛ لطفاً شرح پرونده را کامل‌تر وارد کنید.
                  </p>
                )}
              </CardContent>
            </Card>

            {(result.cited_precedents.length > 0 || result.graph_relations.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Network className="size-5 text-primary" />
                    رویه قضایی و گراف حقوقی
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  {result.cited_precedents.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {result.cited_precedents.map((precedent, index) => (
                        <Badge key={`${precedent}-${index}`} variant="secondary">
                          {precedent}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {result.graph_relations.map((relation, index) => (
                    <div key={`${relation.source}-${index}`} className="rounded-lg bg-muted/30 px-3 py-2">
                      <span className="font-semibold">{relation.source}</span>
                      <span className="mx-1.5 text-primary">—[{relation.relation}]→</span>
                      <span className="font-semibold">{relation.target}</span>
                      {relation.description && (
                        <p className="mt-1 text-muted-foreground">{relation.description}</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card className="flex min-h-[320px] items-center justify-center border-dashed p-8 text-center">
            <div className="space-y-3 text-muted-foreground">
              <Scale className="mx-auto size-12 text-muted-foreground/40" />
              <p className="text-sm">
                پس از ثبت شرح پرونده، مواد قانونی، استدلال قضایی و لایحه ساختاریافته در این بخش نمایش داده می‌شود.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
