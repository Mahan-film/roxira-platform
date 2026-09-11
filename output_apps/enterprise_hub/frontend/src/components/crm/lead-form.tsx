"use client";

import { useState, type FormEvent } from "react";
import {
  CheckCircle2Icon,
  Loader2Icon,
  SendHorizonalIcon,
  UserPlus,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createLead } from "@/lib/api/crm-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGE_ORDER,
  PipelineStage,
  type Lead,
} from "@/types/crm";

interface LeadFormProps {
  onCreated?: (lead: Lead) => void;
}

/**
 * فرم ثبت سرنخ فروش جدید (Lead) متصل به
 * `POST /enterprise-hub/crm/leads`.
 */
export function LeadForm({ onCreated }: LeadFormProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [owner, setOwner] = useState("");
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>(
    PipelineStage.NEW,
  );
  const [notes, setNotes] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function validate(): string[] {
    const messages: string[] = [];
    if (fullName.trim().length < 2) {
      messages.push("نام و نام خانوادگی باید حداقل ۲ نویسه باشد.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      messages.push("رایانامه معتبر وارد کنید.");
    }
    if (estimatedValue.trim() && Number(estimatedValue) < 0) {
      messages.push("ارزش برآوردی نمی‌تواند منفی باشد.");
    }
    return messages;
  }

  async function submit() {
    setErrors(null);
    setSuccessMessage(null);

    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const lead = await createLead({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        pipelineStage,
        estimatedValue: estimatedValue.trim()
          ? Number(estimatedValue)
          : undefined,
        owner: owner.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      setSuccessMessage(
        `سرنخ «${lead.fullName}» با موفقیت در مرحله ${PIPELINE_STAGE_LABELS[lead.pipelineStage]} ثبت شد.`,
      );
      setFullName("");
      setEmail("");
      setPhone("");
      setCompany("");
      setEstimatedValue("");
      setOwner("");
      setNotes("");
      setPipelineStage(PipelineStage.NEW);
      onCreated?.(lead);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.details);
      } else {
        setErrors([
          "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
        ]);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-4 text-indigo-500" />
          ثبت سرنخ فروش جدید
        </CardTitle>
        <CardDescription>
          سرنخ تازه در ابتدای پایپ‌لاین قرار می‌گیرد و در تابلوی کانبان قابل
          پیگیری است.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="lead-full-name">نام و نام خانوادگی</Label>
              <Input
                id="lead-full-name"
                value={fullName}
                placeholder="مثلاً سارا محمدی"
                onChange={(event) => setFullName(event.target.value)}
                maxLength={120}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lead-email">رایانامه</Label>
              <Input
                id="lead-email"
                type="email"
                dir="ltr"
                value={email}
                placeholder="name@example.com"
                onChange={(event) => setEmail(event.target.value)}
                maxLength={120}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lead-phone">شماره تماس</Label>
              <Input
                id="lead-phone"
                dir="ltr"
                value={phone}
                placeholder="09121234567"
                onChange={(event) => setPhone(event.target.value)}
                maxLength={50}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lead-company">شرکت / سازمان</Label>
              <Input
                id="lead-company"
                value={company}
                placeholder="نام شرکت"
                onChange={(event) => setCompany(event.target.value)}
                maxLength={150}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lead-value">ارزش برآوردی (ریال)</Label>
              <Input
                id="lead-value"
                inputMode="decimal"
                value={estimatedValue}
                placeholder="0"
                onChange={(event) => setEstimatedValue(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lead-owner">کارشناس مسئول</Label>
              <Input
                id="lead-owner"
                value={owner}
                placeholder="مثلاً کارشناس فروش ۱"
                onChange={(event) => setOwner(event.target.value)}
                maxLength={120}
              />
            </div>

            <div className="grid gap-2">
              <Label>مرحله پایپ‌لاین</Label>
              <Select<string>
                value={pipelineStage}
                onValueChange={(value) =>
                  setPipelineStage((value as PipelineStage) ?? PipelineStage.NEW)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب مرحله" />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGE_ORDER.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {PIPELINE_STAGE_LABELS[stage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="lead-notes">یادداشت آغازین</Label>
            <Textarea
              id="lead-notes"
              value={notes}
              placeholder="نیاز مشتری، منبع آشنایی و ..."
              onChange={(event) => setNotes(event.target.value)}
              maxLength={4000}
            />
          </div>

          {errors && (
            <Alert variant="destructive">
              <AlertTitle>خطا در ثبت سرنخ</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {successMessage && (
            <Alert>
              <CheckCircle2Icon className="size-4 text-emerald-500" />
              <AlertTitle>سرنخ ثبت شد</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? (
              <>
                <Loader2Icon className="animate-spin" />
                در حال ثبت...
              </>
            ) : (
              <>
                <SendHorizonalIcon />
                ثبت سرنخ
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
