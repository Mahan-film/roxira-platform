"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Waitlist form for the Malaysian legal research pilot (roxira.net/en/malaysia-lawyers).
 *
 * Stored in `enterprise_inquiries` through the same Next.js proxy as the sales form
 * (`/api/v1/enterprise/inquiry` → NestJS `POST /v1/enterprise/inquiries`), tagged with
 * `source = MY_LEGAL_WAITLIST_SOURCE` so the owner can filter the pilot sign-ups.
 */
export const MY_LEGAL_WAITLIST_SOURCE = "my-legal-waitlist";
/** Version of the consent sentence shown next to the checkbox; bump it when that text changes. */
export const MY_LEGAL_CONSENT_VERSION = "my-waitlist-consent-2026-10-23";

const INQUIRY_ENDPOINT = "/api/v1/enterprise/inquiry";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;
// NestJS caps `message` at MAX_INQUIRY_MESSAGE_LENGTH; stay well below it.
const MAX_NOTES = 1000;

type Status = "idle" | "submitting" | "success" | "error";

interface FormState {
  name: string;
  firm: string;
  email: string;
  phone: string;
  practice: string;
  notes: string;
  consent: boolean;
}

type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  name: "",
  firm: "",
  email: "",
  phone: "",
  practice: "",
  notes: "",
  consent: false,
};

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (form.name.trim().length < 2) errors.name = "Enter your name.";
  if (form.firm.trim().length < 2)
    errors.firm = "Enter your firm or chambers (or “Sole proprietor”).";
  if (!EMAIL_RE.test(form.email.trim())) errors.email = "Enter a valid email address.";
  if (!PHONE_RE.test(form.phone.trim())) errors.phone = "Enter a phone number, e.g. +60 12-345 6789.";
  if (!form.consent) errors.consent = "Please confirm so we can contact you.";
  return errors;
}

function buildMessage(form: FormState): string {
  const parts = [
    form.practice.trim() && `Practice areas: ${form.practice.trim()}`,
    form.notes.trim() && `Notes: ${form.notes.trim()}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export function MyLegalWaitlistForm() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<Status>("idle");

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "submitting") return;
    const next = validate(form);
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setStatus("submitting");
    try {
      const message = buildMessage(form);
      const res = await fetch(INQUIRY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          company: form.firm.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          ...(message ? { message } : {}),
          source: MY_LEGAL_WAITLIST_SOURCE,
          consent: form.consent,
          consentVersion: MY_LEGAL_CONSENT_VERSION,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6"
      >
        <CheckCircle2 className="size-6 text-foreground" aria-hidden />
        <h3 className="text-lg font-semibold">You are on the pilot list</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Thank you. We will email you when the pilot opens, and before that only if we have a
          question about how you would use it. Nothing else.
        </p>
      </div>
    );
  }

  const field = (key: keyof FormState) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};
  const errorText = (key: keyof FormState) =>
    errors[key] ? (
      <p id={`${key}-error`} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid grid-cols-1 gap-5 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Full name</Label>
        <Input
          id="name"
          autoComplete="name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          maxLength={150}
          {...field("name")}
        />
        {errorText("name")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="firm">Firm or chambers</Label>
        <Input
          id="firm"
          autoComplete="organization"
          placeholder="Sole proprietor is fine"
          value={form.firm}
          onChange={(e) => update("firm", e.target.value)}
          maxLength={150}
          {...field("firm")}
        />
        {errorText("firm")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          maxLength={150}
          {...field("email")}
        />
        {errorText("email")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Phone / WhatsApp</Label>
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+60 12-345 6789"
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
          maxLength={20}
          {...field("phone")}
        />
        {errorText("phone")}
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="practice">Main practice areas (optional)</Label>
        <Input
          id="practice"
          placeholder="e.g. conveyancing, employment, civil litigation"
          value={form.practice}
          onChange={(e) => update("practice", e.target.value)}
          maxLength={200}
        />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="notes">Which research task costs you the most time? (optional)</Label>
        <Textarea
          id="notes"
          rows={3}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          maxLength={MAX_NOTES}
        />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <label htmlFor="consent" className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <input
            id="consent"
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={form.consent}
            onChange={(e) => update("consent", e.target.checked)}
            {...field("consent")}
          />
          <span>
            I agree that Roxira stores these details to contact me about the pilot, as described in
            the privacy note below.
          </span>
        </label>
        {errorText("consent")}
      </div>
      <div className="flex flex-col items-start gap-3 sm:col-span-2">
        <Button type="submit" size="lg" disabled={status === "submitting"} className="px-5">
          {status === "submitting" ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Join the pilot waitlist
        </Button>
        {status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            Something went wrong and your details were not saved. Please try again in a few minutes.
          </p>
        ) : null}
      </div>
    </form>
  );
}
