/**
 * تایپ‌های مشترک ماژول ورود داده با کمک هوش مصنوعی (AI-assisted data import).
 * منطبق بر DTOهای Swagger بک‌اند NestJS در `modules/data_import/dto`
 * (Contract-First Synchronization — Rule #4).
 */

/** فیلدهای قابل‌نگاشت سرنخ CRM. */
export type LeadImportField =
  | "fullName"
  | "email"
  | "phone"
  | "company"
  | "pipelineStage"
  | "estimatedValue"
  | "owner"
  | "notes";

export const LEAD_IMPORT_FIELD_ORDER: LeadImportField[] = [
  "fullName",
  "email",
  "phone",
  "company",
  "pipelineStage",
  "estimatedValue",
  "owner",
  "notes",
];

export const LEAD_IMPORT_FIELD_LABELS: Record<LeadImportField, string> = {
  fullName: "نام و نام خانوادگی",
  email: "رایانامه",
  phone: "شماره تماس",
  company: "شرکت / سازمان",
  pipelineStage: "مرحله پایپ‌لاین",
  estimatedValue: "ارزش برآوردی",
  owner: "کارشناس مسئول",
  notes: "یادداشت",
};

export type ImportMappingSource = "llm" | "fallback";

/** پاسخ پیش‌نمایش بارگذاری — POST .../crm-leads/preview */
export interface LeadImportPreview {
  uploadId: string;
  headers: string[];
  sampleRows: string[][];
  mapping: Record<string, string>;
  mappingSource: ImportMappingSource;
  totalRows: number;
}

/** ورودی تأیید و ورود — POST .../crm-leads/commit */
export interface LeadImportCommitRequest {
  uploadId: string;
  mapping: Record<string, string>;
}

/** خطای یک ردیف در هنگام ورود. */
export interface LeadImportRowError {
  row: number;
  reason: string;
}

/** نتیجه نهایی ورود سرنخ‌ها. */
export interface LeadImportResult {
  imported: number;
  skipped: number;
  errors: LeadImportRowError[];
}
