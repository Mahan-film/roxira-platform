/**
 * تایپ‌های مشترک ماژول CRM و پایپ‌لاین سرنخ‌های فروش.
 * این تایپ‌ها دقیقاً منطبق بر DTOهای Swagger بک‌اند NestJS در
 * `modules/crm/dto` هستند (Contract-First Synchronization — Rule #4).
 */

export enum PipelineStage {
  NEW = "NEW",
  CONTACTED = "CONTACTED",
  QUALIFIED = "QUALIFIED",
  PROPOSAL = "PROPOSAL",
  WON = "WON",
  LOST = "LOST",
}

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  PipelineStage.NEW,
  PipelineStage.CONTACTED,
  PipelineStage.QUALIFIED,
  PipelineStage.PROPOSAL,
  PipelineStage.WON,
  PipelineStage.LOST,
];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  [PipelineStage.NEW]: "سرنخ جدید",
  [PipelineStage.CONTACTED]: "تماس گرفته‌شده",
  [PipelineStage.QUALIFIED]: "واجد شرایط",
  [PipelineStage.PROPOSAL]: "ارسال پیشنهاد",
  [PipelineStage.WON]: "برنده‌شده",
  [PipelineStage.LOST]: "از دست رفته",
};

/** مراحل باز پایپ‌لاین که ارزش آن‌ها درآمد بالقوه محسوب می‌شود. */
export const OPEN_PIPELINE_STAGES: PipelineStage[] = [
  PipelineStage.NEW,
  PipelineStage.CONTACTED,
  PipelineStage.QUALIFIED,
  PipelineStage.PROPOSAL,
];

/** رنگ‌بندی مراحل برای تابلوی کانبان. */
export const PIPELINE_STAGE_ACCENTS: Record<PipelineStage, string> = {
  [PipelineStage.NEW]: "from-sky-500/15 ring-sky-500/30 text-sky-500",
  [PipelineStage.CONTACTED]: "from-violet-500/15 ring-violet-500/30 text-violet-500",
  [PipelineStage.QUALIFIED]: "from-indigo-500/15 ring-indigo-500/30 text-indigo-500",
  [PipelineStage.PROPOSAL]: "from-amber-500/15 ring-amber-500/30 text-amber-500",
  [PipelineStage.WON]: "from-emerald-500/15 ring-emerald-500/30 text-emerald-500",
  [PipelineStage.LOST]: "from-rose-500/15 ring-rose-500/30 text-rose-500",
};

export enum ContactChannel {
  PHONE = "PHONE",
  EMAIL = "EMAIL",
  MEETING = "MEETING",
  SMS = "SMS",
  OTHER = "OTHER",
}

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  [ContactChannel.PHONE]: "تماس تلفنی",
  [ContactChannel.EMAIL]: "رایانامه",
  [ContactChannel.MEETING]: "جلسه",
  [ContactChannel.SMS]: "پیامک",
  [ContactChannel.OTHER]: "سایر",
};

export interface Lead {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  company: string | null;
  pipelineStage: PipelineStage;
  estimatedValue: number;
  owner: string | null;
  notes: string | null;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadDto {
  fullName: string;
  email: string;
  phone?: string;
  company?: string;
  pipelineStage?: PipelineStage;
  estimatedValue?: number;
  owner?: string;
  notes?: string;
}

export interface UpdateLeadDto {
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  pipelineStage?: PipelineStage;
  estimatedValue?: number;
  owner?: string;
  notes?: string;
}

export interface UpdateLeadStageDto {
  pipelineStage: PipelineStage;
}

export interface AddLeadNoteDto {
  note: string;
}

export interface CreateContactRecordDto {
  subject: string;
  message: string;
  channel?: ContactChannel;
  senderName?: string;
  senderPhone?: string;
  senderEmail?: string;
}

export interface ContactMessage {
  id: number;
  leadId: number | null;
  senderName: string;
  senderPhone: string;
  senderEmail: string | null;
  subject: string;
  message: string;
  channel: ContactChannel | null;
  createdAt: string;
}

export interface QueryLeadDto {
  page?: number;
  limit?: number;
  stage?: PipelineStage;
  search?: string;
}

export interface PaginatedLeadsResponse {
  data: Lead[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedContactMessagesResponse {
  data: ContactMessage[];
  total: number;
  page: number;
  limit: number;
}

export interface StageMetric {
  stage: PipelineStage;
  count: number;
  value: number;
  share: number;
}

export interface LeadStats {
  totalLeads: number;
  openLeads: number;
  wonLeads: number;
  lostLeads: number;
  openPipelineValue: number;
  wonRevenue: number;
  lostValue: number;
  totalPipelineValue: number;
  averageDealValue: number;
  conversionRate: number;
  winRate: number;
  byStage: StageMetric[];
}

export interface PipelineStageGroup {
  stage: PipelineStage;
  count: number;
  totalValue: number;
  leads: Lead[];
}
