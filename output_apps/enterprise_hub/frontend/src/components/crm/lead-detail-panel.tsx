"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Building2,
  CalendarClock,
  CheckCircle2Icon,
  Loader2Icon,
  Mail,
  MessageSquare,
  Phone,
  Send,
  StickyNote,
  UserRound,
  Pencil,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { CustomerPartyTabs } from "@/components/crm/customer-party-tabs";
import {
  addContactRecord,
  addLeadNote,
  listContactRecords,
  updateLead,
  updateLeadStage,
} from "@/lib/api/crm-client";
import { ApiClientError } from "@/lib/api/http-client";
import { checkParty } from "@/lib/crm-party";
import { formatPersianDate, formatRial } from "@/lib/format";
import {
  CONTACT_CHANNEL_LABELS,
  ContactChannel,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGE_ORDER,
  PipelineStage,
  type ContactMessage,
  type Lead,
  type UpdateLeadDto,
} from "@/types/crm";

interface LeadDetailPanelProps {
  lead: Lead;
  onUpdated: (lead: Lead) => void;
  onContactAdded?: () => void;
  onClose: () => void;
}

function extractErrorMessages(error: unknown): string[] {
  if (error instanceof ApiClientError) {
    return error.details;
  }
  return ["ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید."];
}

/**
 * پنل جزئیات سرنخ: نمایش اطلاعات، انتقال مرحله، ثبت یادداشت و
 * مدیریت سوابق تماس — متصل به اندپوینت‌های `leads/:id` ماژول CRM.
 */
export function LeadDetailPanel({
  lead,
  onUpdated,
  onContactAdded,
  onClose,
}: LeadDetailPanelProps) {
  const [contacts, setContacts] = useState<ContactMessage[]>([]);
  /** Lead whose contact list has finished loading; any other lead shows the spinner. */
  const [contactsLeadId, setContactsLeadId] = useState<typeof lead.id | null>(null);
  const isLoadingContacts = contactsLeadId !== lead.id;
  const [isChangingStage, setIsChangingStage] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const party = checkParty(lead);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveEdit(payload: UpdateLeadDto) {
    setIsSavingEdit(true);
    setErrorMessage(null);
    try {
      const updated = await updateLead(lead.id, payload);
      onUpdated(updated);
      setEditing(false);
    } catch (error) {
      setErrorMessage(extractErrorMessages(error).join(" | "));
    } finally {
      setIsSavingEdit(false);
    }
  }

  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<ContactChannel>(ContactChannel.PHONE);

  const loadContacts = useCallback(
    (signal?: AbortSignal) =>
      listContactRecords(lead.id, signal)
        .then(
          (result) => setContacts(result.data),
          (error: unknown) => {
            if (!(error instanceof DOMException)) {
              setErrorMessage(extractErrorMessages(error).join(" | "));
            }
          },
        )
        .finally(() => {
          if (!signal?.aborted) setContactsLeadId(lead.id);
        }),
    [lead.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadContacts(controller.signal);
    return () => controller.abort();
  }, [loadContacts]);

  async function handleStageChange(stage: PipelineStage) {
    if (stage === lead.pipelineStage) {
      return;
    }
    setIsChangingStage(true);
    setErrorMessage(null);
    try {
      const updated = await updateLeadStage(lead.id, stage);
      onUpdated(updated);
    } catch (error) {
      setErrorMessage(extractErrorMessages(error).join(" | "));
    } finally {
      setIsChangingStage(false);
    }
  }

  async function handleAddNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) {
      return;
    }
    setIsSavingNote(true);
    setErrorMessage(null);
    try {
      const updated = await addLeadNote(lead.id, { note: note.trim() });
      onUpdated(updated);
      setNote("");
    } catch (error) {
      setErrorMessage(extractErrorMessages(error).join(" | "));
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleAddContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject.trim() || !message.trim()) {
      return;
    }
    setIsSavingContact(true);
    setErrorMessage(null);
    try {
      await addContactRecord(lead.id, {
        subject: subject.trim(),
        message: message.trim(),
        channel,
      });
      setSubject("");
      setMessage("");
      setChannel(ContactChannel.PHONE);
      await loadContacts();
      onContactAdded?.();
    } catch (error) {
      setErrorMessage(extractErrorMessages(error).join(" | "));
    } finally {
      setIsSavingContact(false);
    }
  }

  const noteLines = (lead.notes ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="بستن"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={`جزئیات ${lead.fullName}`}
        className="relative h-full w-full max-w-md overflow-y-auto rounded-none"
      >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4 text-indigo-500" />
              <span className="text-xs font-normal text-muted-foreground">شخص تماس:</span>
              {lead.fullName}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1" dir="ltr">
                <Mail className="size-3.5" />
                {lead.email}
              </span>
              {lead.phone && (
                <span className="flex items-center gap-1" dir="ltr">
                  <Phone className="size-3.5" />
                  {lead.phone}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Building2 className="size-3.5" />
                شرکت: {lead.company ?? "—"}
              </span>
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditing((v) => !v)}
            title="ویرایش"
            aria-pressed={editing}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="بستن"
          >
            <X />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Badge variant="secondary">
            {formatRial(lead.estimatedValue)}
          </Badge>
          {lead.owner && (
            <Badge variant="outline">کارشناس: {lead.owner}</Badge>
          )}
          <Badge variant="outline">
            <CalendarClock className="size-3" />
            آخرین تغییر {formatPersianDate(lead.updatedAt)}
          </Badge>
        </div>
      </CardHeader>
      <CustomerPartyTabs lead={lead} />

      <CardContent className="flex flex-col gap-6">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {party.status !== "ok" && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>نیاز به بررسی نام و شرکت</AlertTitle>
            <AlertDescription>
              <span>{party.reason}</span>
              {party.status === "repairable" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 self-start"
                  disabled={isSavingEdit}
                  onClick={() => void saveEdit(party.fix)}
                >
                  <Wand2 />
                  جداسازی: شرکت «{party.fix.company}»، شخص «{party.fix.fullName}»
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {editing && (
          <LeadEditForm
            lead={lead}
            saving={isSavingEdit}
            onCancel={() => setEditing(false)}
            onSave={(payload) => void saveEdit(payload)}
          />
        )}

        {/* انتقال مرحله */}
        <div className="flex flex-col gap-2">
          <Label>مرحله فروش</Label>
          <div className="flex items-center gap-2">
            <Select<string>
              value={lead.pipelineStage}
              onValueChange={(value) =>
                void handleStageChange(value as PipelineStage)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="انتخاب مرحله">
                  {PIPELINE_STAGE_LABELS[lead.pipelineStage]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGE_ORDER.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {PIPELINE_STAGE_LABELS[stage]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isChangingStage && (
              <Loader2Icon className="size-4 animate-spin text-indigo-500" />
            )}
          </div>
        </div>

        {/* یادداشت‌ها */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <StickyNote className="size-4 text-amber-500" />
            سابقه یادداشت‌ها
          </div>

          {noteLines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              هنوز یادداشتی ثبت نشده است.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {noteLines.map((line, index) => (
                <li
                  key={`${index}-${line.slice(0, 12)}`}
                  className="rounded-lg border bg-muted/30 px-3 py-2 text-xs"
                >
                  {line}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddNote} className="flex flex-col gap-2">
            <Textarea
              value={note}
              placeholder="یادداشت جدید..."
              onChange={(event) => setNote(event.target.value)}
              maxLength={4000}
              className="min-h-16"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={isSavingNote || !note.trim()}
              className="self-start"
            >
              {isSavingNote ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Send />
              )}
              ثبت یادداشت
            </Button>
          </form>
        </div>

        {/* سوابق تماس */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="size-4 text-sky-500" />
              سوابق تماس
            </div>
            <Badge variant="outline">
              {contacts.length.toLocaleString("fa-IR")} مورد
            </Badge>
          </div>

          {isLoadingContacts ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              در حال بارگذاری...
            </div>
          ) : contacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              هنوز تماسی ثبت نشده است.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="rounded-lg border bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">
                      {contact.subject}
                    </span>
                    {contact.channel && (
                      <Badge variant="secondary" className="text-[10px]">
                        {CONTACT_CHANNEL_LABELS[contact.channel]}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {contact.message}
                  </p>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {formatPersianDate(contact.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={handleAddContact}
            className="flex flex-col gap-2 rounded-lg border border-dashed p-3"
          >
            <span className="text-xs font-semibold">ثبت تماس جدید</span>
            <Input
              value={subject}
              placeholder="موضوع تماس"
              onChange={(event) => setSubject(event.target.value)}
              maxLength={255}
            />
            <Textarea
              value={message}
              placeholder="خلاصه تعامل با مشتری"
              onChange={(event) => setMessage(event.target.value)}
              maxLength={8000}
              className="min-h-16"
            />
            <div className="flex items-center justify-between gap-2">
              <Select<string>
                value={channel}
                onValueChange={(value) =>
                  setChannel((value as ContactChannel) ?? ContactChannel.PHONE)
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder="کانال">{CONTACT_CHANNEL_LABELS[channel]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.values(ContactChannel).map((item) => (
                    <SelectItem key={item} value={item}>
                      {CONTACT_CHANNEL_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                size="sm"
                disabled={isSavingContact || !subject.trim() || !message.trim()}
              >
                {isSavingContact ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <CheckCircle2Icon />
                )}
                ثبت تماس
              </Button>
            </div>
          </form>
        </div>
      </CardContent>
      </Card>
    </div>
  );
}

function LeadEditForm({
  lead,
  saving,
  onCancel,
  onSave,
}: {
  lead: Lead;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: UpdateLeadDto) => void;
}) {
  const [fullName, setFullName] = useState(lead.fullName);
  const [company, setCompany] = useState(lead.company ?? "");
  const [email, setEmail] = useState(lead.email);
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [owner, setOwner] = useState(lead.owner ?? "");
  const [value, setValue] = useState(String(lead.estimatedValue ?? 0));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(value.replace(/[^\d.]/g, ""));
    onSave({
      fullName: fullName.trim(),
      company: company.trim() || undefined,
      email: email.trim(),
      phone: phone.trim() || undefined,
      owner: owner.trim() || undefined,
      estimatedValue: Number.isFinite(amount) ? amount : 0,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border p-3">
      <Label>شرکت</Label>
      <Input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={255} />
      <Label>شخص تماس</Label>
      <Input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={255} required />
      <Label>ایمیل</Label>
      <Input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Label>تلفن</Label>
      <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} />
      <Label>کارشناس</Label>
      <Input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={255} />
      <Label>ارزش تخمینی (ریال)</Label>
      <Input dir="ltr" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={saving || !fullName.trim() || !email.trim()}>
          {saving && <Loader2Icon className="animate-spin" />}
          ذخیره
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </form>
  );
}
