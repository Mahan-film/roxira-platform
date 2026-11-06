import { API_PROXY_BASE_PATH } from "@/lib/api/config";
import { apiRequest } from "@/lib/api/http-client";
import type { Contract, Movement, PartyOption, ProfitabilityRow, Project, Statement } from "@/types/contracting";

const BASE = `${API_PROXY_BASE_PATH}/enterprise-hub/contracting`;

export const listProjects = (signal?: AbortSignal) =>
  apiRequest<{ data: Project[]; total: number }>(`${BASE}/projects`, { searchParams: { limit: 200 }, signal });
export const createProject = (body: { code: string; name: string; costCentreCode?: string; budget?: string }) =>
  apiRequest<Project>(`${BASE}/projects`, { method: "POST", body });
export const listContracts = (signal?: AbortSignal) =>
  apiRequest<{ data: Contract[]; total: number }>(`${BASE}/contracts`, { searchParams: { limit: 200 }, signal });
export const getContract = (id: number, signal?: AbortSignal) => apiRequest<Contract>(`${BASE}/contracts/${id}`, { signal });
export const createContract = (body: {
  code: string; title: string; side: string; partyCode: string; projectId?: number; contractDate: string; amount: string; advanceAmount?: string; insuranceType?: string;
}) => apiRequest<Contract>(`${BASE}/contracts`, { method: "POST", body });
export const activateContract = (id: number) =>
  apiRequest<Contract>(`${BASE}/contracts/${id}`, { method: "PUT", body: { status: "active" } });
export const listParties = (signal?: AbortSignal) =>
  apiRequest<{ data: PartyOption[] }>(`${API_PROXY_BASE_PATH}/enterprise-hub/parties`, { searchParams: { limit: 200 }, signal });

export const listStatements = (contractId: number, signal?: AbortSignal) =>
  apiRequest<Statement[]>(`${BASE}/contracts/${contractId}/statements`, { signal });
export const createStatement = (contractId: number, body: { statementDate: string; cumulativeAmount: string }) =>
  apiRequest<Statement>(`${BASE}/contracts/${contractId}/statements`, { method: "POST", body });
export const approveStatement = (id: number) => apiRequest<Statement>(`${BASE}/statements/${id}/approve`, { method: "POST" });
export const postStatement = (id: number) => apiRequest<Statement>(`${BASE}/statements/${id}/post`, { method: "POST" });

export const listMovements = (contractId: number, signal?: AbortSignal) =>
  apiRequest<Movement[]>(`${BASE}/contracts/${contractId}/movements`, { signal });
export const createAdvance = (contractId: number, body: { date: string; amount: string; requestKey: string }) =>
  apiRequest<Movement>(`${BASE}/contracts/${contractId}/advances`, { method: "POST", body });
export const releaseRetention = (contractId: number, body: { date: string; amount: string; requestKey: string }) =>
  apiRequest<Movement>(`${BASE}/contracts/${contractId}/retention-releases`, { method: "POST", body });

export const getProfitability = (signal?: AbortSignal) =>
  apiRequest<{ projects: ProfitabilityRow[] }>(`${BASE}/reports/profitability`, { signal });
