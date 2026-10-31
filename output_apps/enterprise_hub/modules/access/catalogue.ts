/**
 * Server-side permission catalogue: modules x actions, system roles and the
 * helpers that turn a role into a permission set. The frontend only mirrors
 * this for hiding UI; every decision is made again on the server.
 */

export enum AccessModule {
  ACCOUNTING = 'accounting',
  BANKING = 'banking',
  CHEQUES = 'cheques',
  INVOICING = 'invoicing',
  TAX = 'tax',
  CRM = 'crm',
  HR = 'hr',
  INVENTORY = 'inventory',
  DAMAGES = 'damages',
  DATA_IMPORT = 'data_import',
  ASSISTANT = 'assistant',
  /** Organisation administration: members, roles, structure. Never entitlement-gated. */
  MEMBERS = 'members',
  /** Organisation security policy and sessions. Never entitlement-gated. */
  SECURITY = 'security',
  /** Audit log viewer. Never entitlement-gated. */
  AUDIT = 'audit',
}

export enum AccessAction {
  READ = 'read',
  CREATE = 'create',
  APPROVE = 'approve',
  POST = 'post',
  EXPORT = 'export',
  ADMIN = 'admin',
}

/** Modules that exist for every organisation and are not sold separately. */
export const CORE_MODULES: readonly AccessModule[] = [
  AccessModule.MEMBERS,
  AccessModule.SECURITY,
  AccessModule.AUDIT,
];

/** Modules a customer can buy individually. */
export const SELLABLE_MODULES: readonly AccessModule[] = Object.values(AccessModule).filter(
  (m) => !CORE_MODULES.includes(m),
);

export const ALL_ACTIONS: readonly AccessAction[] = Object.values(AccessAction);

export type Permission = `${AccessModule}:${AccessAction}`;

export const permissionOf = (module: AccessModule, action: AccessAction): Permission =>
  `${module}:${action}`;

/** Every permission that exists. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(AccessModule).flatMap((m) =>
  ALL_ACTIONS.map((a) => permissionOf(m, a)),
);

const ALL_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export const isPermission = (value: string): value is Permission => ALL_SET.has(value);

const perms = (module: AccessModule, ...actions: AccessAction[]): Permission[] =>
  actions.map((a) => permissionOf(module, a));

const { READ, CREATE, APPROVE, POST, EXPORT, ADMIN } = AccessAction;
const M = AccessModule;

export enum SystemRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  ACCOUNTANT = 'accountant',
  SALES = 'sales',
  CHEQUE_REVIEWER = 'cheque_reviewer',
  HR = 'hr',
  READ_ONLY = 'read_only',
  /** What a plain MEMBER could do before roles existed. Kept so migrated staff lose nothing and gain nothing. */
  LEGACY_MEMBER = 'legacy_member',
}

export interface SystemRoleDefinition {
  key: SystemRole;
  /** Not offered when assigning roles (kept only for migrated members). */
  deprecated?: boolean;
  permissions: readonly Permission[];
}

/** Business modules only: admin areas (members, security, audit) stay with owner/admin. */
const readAll = (): Permission[] => SELLABLE_MODULES.map((m) => permissionOf(m, READ));

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  { key: SystemRole.OWNER, permissions: ALL_PERMISSIONS },
  {
    key: SystemRole.ADMIN,
    // Everything except handing out ownership-level powers over security policy.
    permissions: ALL_PERMISSIONS.filter((p) => p !== permissionOf(M.SECURITY, ADMIN)),
  },
  {
    key: SystemRole.ACCOUNTANT,
    permissions: [
      ...perms(M.ACCOUNTING, READ, CREATE, APPROVE, POST, EXPORT),
      ...perms(M.BANKING, READ, CREATE, POST, EXPORT),
      ...perms(M.CHEQUES, READ, CREATE, POST, EXPORT),
      ...perms(M.INVOICING, READ, CREATE, APPROVE, POST, EXPORT),
      ...perms(M.TAX, READ, CREATE, APPROVE, POST, EXPORT),
      ...perms(M.DATA_IMPORT, READ, CREATE),
      ...perms(M.ASSISTANT, READ),
    ],
  },
  {
    key: SystemRole.SALES,
    permissions: [
      ...perms(M.CRM, READ, CREATE, EXPORT),
      ...perms(M.INVOICING, READ, CREATE),
      ...perms(M.INVENTORY, READ),
      ...perms(M.ASSISTANT, READ),
    ],
  },
  {
    key: SystemRole.CHEQUE_REVIEWER,
    permissions: [...perms(M.CHEQUES, READ, APPROVE), ...perms(M.BANKING, READ)],
  },
  {
    key: SystemRole.HR,
    permissions: [...perms(M.HR, READ, CREATE, APPROVE, POST, EXPORT), ...perms(M.ASSISTANT, READ)],
  },
  { key: SystemRole.READ_ONLY, permissions: readAll() },
  {
    key: SystemRole.LEGACY_MEMBER,
    deprecated: true,
    permissions: [
      ...perms(M.CRM, READ, CREATE),
      ...perms(M.ASSISTANT, READ),
    ],
  },
];

const ROLE_INDEX = new Map(SYSTEM_ROLES.map((r) => [r.key as string, r]));

export const isSystemRole = (key: string): key is SystemRole => ROLE_INDEX.has(key);

export const systemRolePermissions = (key: string): readonly Permission[] =>
  ROLE_INDEX.get(key)?.permissions ?? [];

/** True when `granter` holds every permission in `wanted` (no privilege escalation through custom roles). */
export function canGrant(granter: ReadonlySet<string>, wanted: readonly string[]): boolean {
  return wanted.every((p) => granter.has(p));
}

/**
 * Which modules need which others (payroll lives in `hr` and posts to the ledger, so it needs
 * accounting). Enforced when a platform operator enables a module. No prices here, by design.
 */
export const MODULE_DEPENDENCIES: Readonly<Partial<Record<AccessModule, readonly AccessModule[]>>> = {
  [AccessModule.HR]: [AccessModule.ACCOUNTING],
  [AccessModule.BANKING]: [AccessModule.ACCOUNTING],
  [AccessModule.CHEQUES]: [AccessModule.BANKING],
  [AccessModule.INVOICING]: [AccessModule.ACCOUNTING],
  [AccessModule.TAX]: [AccessModule.INVOICING],
};

export const dependenciesOf = (m: AccessModule): readonly AccessModule[] => MODULE_DEPENDENCIES[m] ?? [];

export const dependentsOf = (m: AccessModule): AccessModule[] =>
  SELLABLE_MODULES.filter((x) => dependenciesOf(x).includes(m));

/** Dependencies of `m` that are not in `enabled`. */
export const missingDependencies = (m: AccessModule, enabled: ReadonlySet<string>): AccessModule[] =>
  dependenciesOf(m).filter((d) => !enabled.has(d));
