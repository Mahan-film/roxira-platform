import {
  AddLeadNoteDto,
  ContactMessage,
  CreateContactRecordDto,
  CreateLeadDto,
  Lead,
  LeadStats,
  PaginatedContactMessagesResponse,
  PaginatedLeadsResponse,
  PipelineStage,
  PipelineStageGroup,
  QueryLeadDto,
  UpdateLeadDto,
  UpdateLeadStageDto,
} from "@/types/crm";
import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, CRM_RESOURCE_PATH } from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const CRM_ENDPOINT = `${API_PROXY_BASE_PATH}/${CRM_RESOURCE_PATH}`;

/** ثبت سرنخ جدید — POST /enterprise-hub/crm/leads */
export async function createLead(
  payload: CreateLeadDto,
  signal?: AbortSignal,
): Promise<Lead> {
  return apiRequest<Lead>(`${CRM_ENDPOINT}/leads`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** فهرست سرنخ‌ها — GET /enterprise-hub/crm/leads */
export async function listLeads(
  params: QueryLeadDto = {},
  signal?: AbortSignal,
): Promise<PaginatedLeadsResponse> {
  return apiRequest<PaginatedLeadsResponse>(`${CRM_ENDPOINT}/leads`, {
    method: "GET",
    searchParams: {
      page: params.page,
      limit: params.limit,
      stage: params.stage,
      search: params.search,
    },
    signal,
  });
}

/** دریافت یک سرنخ — GET /enterprise-hub/crm/leads/:id */
export async function getLead(
  id: number,
  signal?: AbortSignal,
): Promise<Lead> {
  return apiRequest<Lead>(`${CRM_ENDPOINT}/leads/${id}`, {
    method: "GET",
    signal,
  });
}

/** ویرایش اطلاعات سرنخ — PATCH /enterprise-hub/crm/leads/:id */
export async function updateLead(
  id: number,
  payload: UpdateLeadDto,
  signal?: AbortSignal,
): Promise<Lead> {
  return apiRequest<Lead>(`${CRM_ENDPOINT}/leads/${id}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/** انتقال سرنخ بین مراحل فروش — PATCH /enterprise-hub/crm/leads/:id/stage */
export async function updateLeadStage(
  id: number,
  stage: PipelineStage,
  signal?: AbortSignal,
): Promise<Lead> {
  const payload: UpdateLeadStageDto = { pipelineStage: stage };
  return apiRequest<Lead>(`${CRM_ENDPOINT}/leads/${id}/stage`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/** افزودن یادداشت به سرنخ — POST /enterprise-hub/crm/leads/:id/notes */
export async function addLeadNote(
  id: number,
  payload: AddLeadNoteDto,
  signal?: AbortSignal,
): Promise<Lead> {
  return apiRequest<Lead>(`${CRM_ENDPOINT}/leads/${id}/notes`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** سوابق تماس یک سرنخ — GET /enterprise-hub/crm/leads/:id/contacts */
export async function listContactRecords(
  id: number,
  signal?: AbortSignal,
): Promise<PaginatedContactMessagesResponse> {
  return apiRequest<PaginatedContactMessagesResponse>(
    `${CRM_ENDPOINT}/leads/${id}/contacts`,
    { method: "GET", signal },
  );
}

/** ثبت سابقه تماس جدید — POST /enterprise-hub/crm/leads/:id/contacts */
export async function addContactRecord(
  id: number,
  payload: CreateContactRecordDto,
  signal?: AbortSignal,
): Promise<ContactMessage> {
  return apiRequest<ContactMessage>(`${CRM_ENDPOINT}/leads/${id}/contacts`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** آمار تحلیلی فروش — GET /enterprise-hub/crm/stats */
export async function getLeadStats(
  signal?: AbortSignal,
): Promise<LeadStats> {
  return apiRequest<LeadStats>(`${CRM_ENDPOINT}/stats`, {
    method: "GET",
    signal,
  });
}

/** پایپ‌لاین گروه‌بندی‌شده برای کانبان — GET /enterprise-hub/crm/pipeline */
export async function getPipeline(
  signal?: AbortSignal,
): Promise<PipelineStageGroup[]> {
  return apiRequest<PipelineStageGroup[]>(`${CRM_ENDPOINT}/pipeline`, {
    method: "GET",
    signal,
  });
}
