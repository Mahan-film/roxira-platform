import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH } from "@/lib/api/config";
import type {
  AuditEntry,
  Branch,
  CreatedInvitation,
  CustomRole,
  Department,
  EntitlementView,
  Invitation,
  InvitationPreview,
  Member,
  MyAccess,
  OrganizationSummary,
  RolesResponse,
  SessionView,
  TenantListItem,
} from "@/types/access";

/**
 * Client of the organisation access-control API. The UI uses it to *show* what
 * the user may do; the server re-checks every request (AccessGuard).
 */
const BASE = API_PROXY_BASE_PATH;
const ORG = `${BASE}/org`;
const AUTH = `${BASE}/auth`;

export const getMyAccess = (signal?: AbortSignal) => apiRequest<MyAccess>(`${ORG}/me`, { signal });

export const createOrganization = (name: string) =>
  apiRequest<{ tenantId: string }>(ORG, { method: "POST", body: { name } });

export const listOrganizations = (signal?: AbortSignal) =>
  apiRequest<OrganizationSummary[]>(`${AUTH}/organizations`, { signal });

export const switchOrganization = (tenantId: string) =>
  apiRequest<{ accessToken: string; expiresIn: number; tenantId: string }>(`${AUTH}/switch-tenant`, {
    method: "POST",
    body: { tenantId },
  });

// ------------------------------------------------------------ members & invites
export const listMembers = (signal?: AbortSignal) => apiRequest<Member[]>(`${ORG}/members`, { signal });

export interface MemberPatch {
  roleKey?: string;
  customRoleId?: string;
  branchId?: string | null;
  departmentId?: string | null;
  branchScoped?: boolean;
  status?: "ACTIVE" | "SUSPENDED";
}
export const updateMember = (id: string, patch: MemberPatch) =>
  apiRequest<Member>(`${ORG}/members/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });

export interface ManagedMemberInput {
  username: string;
  password: string;
  displayName?: string;
  roleKey: string;
  customRoleId?: string;
}

export const createManagedMember = (input: ManagedMemberInput) =>
  apiRequest<{ id: string; username: string }>(`${ORG}/members`, { method: "POST", body: input });

export const resetManagedPassword = (id: string, password: string) =>
  apiRequest<void>(`${ORG}/members/${encodeURIComponent(id)}/password`, { method: "POST", body: { password } });

export const removeMember = (id: string) =>
  apiRequest<void>(`${ORG}/members/${encodeURIComponent(id)}`, { method: "DELETE" });

export const listInvitations = (signal?: AbortSignal) => apiRequest<Invitation[]>(`${ORG}/invitations`, { signal });

export interface InvitationInput {
  email?: string;
  phone?: string;
  roleKey: string;
  customRoleId?: string;
  branchId?: string;
  departmentId?: string;
  branchScoped?: boolean;
  locale?: "en" | "fa";
}
export const createInvitation = (input: InvitationInput) =>
  apiRequest<CreatedInvitation>(`${ORG}/invitations`, { method: "POST", body: input });

export const revokeInvitation = (id: string) =>
  apiRequest<void>(`${ORG}/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });

export const previewInvitation = (token: string, signal?: AbortSignal) =>
  apiRequest<InvitationPreview>(`${BASE}/invitations/${encodeURIComponent(token)}`, { signal });

export const acceptInvitation = (token: string) =>
  apiRequest<{ tenantId: string }>(`${BASE}/invitations/accept`, { method: "POST", body: { token } });

// ------------------------------------------------------------------------ roles
export const listRoles = (signal?: AbortSignal) => apiRequest<RolesResponse>(`${ORG}/roles`, { signal });
export const createRole = (name: string, permissions: string[]) =>
  apiRequest<CustomRole>(`${ORG}/roles`, { method: "POST", body: { name, permissions } });
export const updateRole = (id: string, patch: { name?: string; permissions?: string[] }) =>
  apiRequest<CustomRole>(`${ORG}/roles/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
export const deleteRole = (id: string) =>
  apiRequest<void>(`${ORG}/roles/${encodeURIComponent(id)}`, { method: "DELETE" });

// -------------------------------------------------------------------- structure
export const listBranches = (signal?: AbortSignal) => apiRequest<Branch[]>(`${ORG}/branches`, { signal });
export const createBranch = (name: string, code?: string, parentId?: string) =>
  apiRequest<Branch>(`${ORG}/branches`, { method: "POST", body: { name, code, parentId } });
export const deleteBranch = (id: string) =>
  apiRequest<void>(`${ORG}/branches/${encodeURIComponent(id)}`, { method: "DELETE" });
export const listDepartments = (signal?: AbortSignal) => apiRequest<Department[]>(`${ORG}/departments`, { signal });
export const createDepartment = (name: string, branchId?: string) =>
  apiRequest<Department>(`${ORG}/departments`, { method: "POST", body: { name, branchId } });
export const deleteDepartment = (id: string) =>
  apiRequest<void>(`${ORG}/departments/${encodeURIComponent(id)}`, { method: "DELETE" });

// ----------------------------------------------------- security, audit, sessions
export const getSecurityPolicy = (signal?: AbortSignal) =>
  apiRequest<{ require2fa: boolean }>(`${ORG}/security`, { signal });
export const setSecurityPolicy = (require2fa: boolean) =>
  apiRequest<{ require2fa: boolean }>(`${ORG}/security`, { method: "PATCH", body: { require2fa } });

export const listAudit = (
  params: { before?: string; action?: string; limit?: number },
  signal?: AbortSignal,
) =>
  apiRequest<{ items: AuditEntry[]; nextBefore: string | null }>(`${ORG}/audit`, {
    searchParams: params,
    signal,
  });

export const listSessions = (signal?: AbortSignal) => apiRequest<SessionView[]>(`${AUTH}/sessions`, { signal });
export const revokeSession = (id: string) =>
  apiRequest<void>(`${AUTH}/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
export const revokeOtherSessions = () => apiRequest<{ revoked: number }>(`${AUTH}/sessions`, { method: "DELETE" });

export const getTotpStatus = (signal?: AbortSignal) => apiRequest<{ enabled: boolean }>(`${AUTH}/totp`, { signal });
export const startTotpSetup = () =>
  apiRequest<{ secret: string; otpauthUri: string }>(`${AUTH}/totp/setup`, { method: "POST" });
export const enableTotp = (code: string) =>
  apiRequest<{ recoveryCodes: string[] }>(`${AUTH}/totp/enable`, { method: "POST", body: { code } });
export const disableTotp = (code: string) =>
  apiRequest<void>(`${AUTH}/totp/disable`, { method: "POST", body: { code } });

// ---------------------------------------------------- module entitlements (read)
export const listMyEntitlements = (signal?: AbortSignal) =>
  apiRequest<EntitlementView[]>(`${ORG}/entitlements`, { signal });

// ------------------------------------------- platform operator (Roxira staff only)
export const adminListTenants = (signal?: AbortSignal) =>
  apiRequest<TenantListItem[]>(`${BASE}/admin/entitlements`, { signal });
export const adminGetEntitlements = (tenantId: string, signal?: AbortSignal) =>
  apiRequest<EntitlementView[]>(`${BASE}/admin/entitlements/${encodeURIComponent(tenantId)}`, { signal });
export const adminSetEntitlements = (tenantId: string, changes: Array<{ module: string; enabled: boolean }>) =>
  apiRequest<EntitlementView[]>(`${BASE}/admin/entitlements/${encodeURIComponent(tenantId)}`, {
    method: "PUT",
    body: { changes },
  });

export interface ModuleCatalogue {
  allEnabled: boolean;
  modules: Array<{ module: string; enabled: boolean; dependsOn: string[]; requested: boolean }>;
}
export const getModuleCatalogue = (signal?: AbortSignal) => apiRequest<ModuleCatalogue>(`${ORG}/module-catalogue`, { signal });
export const requestModule = (module: string) =>
  apiRequest<{ requested: true }>(`${ORG}/module-requests`, { method: "POST", body: { module } });
export const verifyAuditChain = (signal?: AbortSignal) =>
  apiRequest<{ ok: boolean; checked: number; brokenAtId: string | null }>(`${ORG}/audit/verify`, { signal });
export const adminOpenRequests = (signal?: AbortSignal) =>
  apiRequest<Array<{ id: string; tenantId: string; module: string; createdAt: string }>>(
    `${BASE}/admin/entitlements/requests/open`,
    { signal },
  );
