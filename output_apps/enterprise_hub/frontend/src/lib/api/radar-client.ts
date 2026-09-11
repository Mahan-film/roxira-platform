import {
  RadarReportResponse,
  RadarScoutStatus,
  RadarSwarmStatus,
  RunSwarmDto,
  TriggerScoutDto,
} from "@/types/radar";
import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, RADAR_RESOURCE_PATH } from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const RADAR_ENDPOINT = `${API_PROXY_BASE_PATH}/${RADAR_RESOURCE_PATH}`;

/** گزارش رسمی رادار فناوری — GET /enterprise-hub/radar/report */
export async function getRadarReport(
  signal?: AbortSignal,
): Promise<RadarReportResponse> {
  return apiRequest<RadarReportResponse>(`${RADAR_ENDPOINT}/report`, {
    method: "GET",
    signal,
  });
}

/** اجرای زنده کاوشگر با موضوع کاربر — POST /enterprise-hub/radar/trigger-scout */
export async function triggerScout(
  payload: TriggerScoutDto,
  signal?: AbortSignal,
): Promise<RadarScoutStatus> {
  return apiRequest<RadarScoutStatus>(`${RADAR_ENDPOINT}/trigger-scout`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** وضعیت زنده کاوشگر — GET /enterprise-hub/radar/scout-status */
export async function getScoutStatus(
  signal?: AbortSignal,
): Promise<RadarScoutStatus> {
  return apiRequest<RadarScoutStatus>(`${RADAR_ENDPOINT}/scout-status`, {
    method: "GET",
    signal,
  });
}

/** اجرای موازی ۱۰ ایجنت — POST /enterprise-hub/radar/run-swarm */
export async function runSwarm(
  payload: RunSwarmDto = {},
  signal?: AbortSignal,
): Promise<RadarSwarmStatus> {
  return apiRequest<RadarSwarmStatus>(`${RADAR_ENDPOINT}/run-swarm`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** وضعیت زنده ۱۰ ایجنت — GET /enterprise-hub/radar/swarm-status */
export async function getSwarmStatus(
  signal?: AbortSignal,
): Promise<RadarSwarmStatus> {
  return apiRequest<RadarSwarmStatus>(`${RADAR_ENDPOINT}/swarm-status`, {
    method: "GET",
    signal,
  });
}
