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
import {
  addContactRecord,
  addLeadNote,
  listContactRecords,
  updateLeadStage,
} from "@/lib/api/crm-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import {
  CONTACT_CHANNEL_LABELS,
  ContactChannel,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGE_ORDER,
  PipelineStage,
  type ContactMessage,
  type Lead,
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
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isChangingStage, setIsChangingStage] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<ContactChannel>(ContactChannel.PHONE);

  const loadContacts = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingContacts(true);
      try {
        const result = await listContactRecords(lead.id, signal);
        setContacts(result.data);
      } catch (error) {
        if (!(error instanceof DOMException)) {
          setErrorMessage(extractErrorMessages(error).join(" | "));
        }
      } finally {
        setIsLoadingContacts(false);
      }
    },
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
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4 text-indigo-500" />
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
              {lead.company && (
                <span className="flex items-center gap-1">
                  <Building2 className="size-3.5" />
                  {lead.company}
                </span>
              )}
            </CardDescription>
          </div>
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

      <CardContent className="flex flex-col gap-6">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
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
                  <SelectValue placeholder="کانال" />
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
  );
}
