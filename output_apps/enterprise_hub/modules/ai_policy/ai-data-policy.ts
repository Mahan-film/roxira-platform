import * as fs from 'fs';
import * as path from 'path';

/** What a piece of data is; see docs/ops/AI_DATA_POLICY.md. */
export type DataClass = 'public' | 'tenant-business' | 'personal';
/** Whether the provider behind a model role may log/train on prompts, and whether it is EU-resident. */
export type ProviderClass = 'may_log' | 'no_log' | 'eu_no_log';
export type PolicyMode = 'test_accounts' | 'production' | 'eu_tenant';

export const DATA_CLASSES: readonly DataClass[] = ['public', 'tenant-business', 'personal'];

/** Default EU-resident, no-training vendor prefixes allowed under the EU tenant profile. */
const DEFAULT_EU_VENDOR_PREFIXES: readonly string[] = ['mistral', 'mistralai'];

export interface EuTenantProfileConfig {
  enabled: boolean;
  envFlag: string;
  defaultForTaxAdvisorTenants: boolean;
  allowServiceImprovementDefault: boolean;
  allowedResidency: string[];
  allowedVendorPrefixes: string[];
}

export interface TenantAiRoutingContext {
  isEuTenant?: boolean;
  isTaxAdvisor?: boolean;
}

const DEFAULT_EU_PROFILE: EuTenantProfileConfig = {
  enabled: false,
  envFlag: 'ROXIRA_EU_TENANT_AI_PROFILE',
  defaultForTaxAdvisorTenants: true,
  allowServiceImprovementDefault: false,
  allowedResidency: ['eu'],
  allowedVendorPrefixes: [...DEFAULT_EU_VENDOR_PREFIXES],
};

/** Thrown when a role's providers are not allowed to see a class of data. */
export class AiDataPolicyError extends Error {
  constructor(
    readonly dataClass: DataClass,
    readonly role: string,
    readonly providerClass: ProviderClass,
    readonly mode: PolicyMode,
  ) {
    super(`AI data policy (${mode}): ${providerClass} providers (role ${role}) may not see ${dataClass} data.`);
  }
}

/** The strictest rules for general production; used whenever the policy file is missing or invalid. */
const STRICT: Record<DataClass, ProviderClass[]> = {
  public: ['may_log', 'no_log', 'eu_no_log'],
  'tenant-business': ['no_log', 'eu_no_log'],
  personal: ['no_log', 'eu_no_log'],
};

/** The strictest rules for EU and tax-advisor tenants (T285 / R29): EU-resident, no-training only. */
const EU_STRICT: Record<DataClass, ProviderClass[]> = {
  public: ['may_log', 'no_log', 'eu_no_log'],
  'tenant-business': ['eu_no_log'],
  personal: ['eu_no_log'],
};

type RawEuProfile = {
  enabled?: boolean;
  env_flag?: string;
  default_for_tax_advisor_tenants?: boolean;
  allow_service_improvement_default?: boolean;
  allowed_residency?: string[];
  allowed_vendor_prefixes?: string[];
};

type RawPolicy = {
  mode?: string;
  provider_classes?: Record<string, string>;
  eu_tenant_profile?: RawEuProfile;
  modes?: Record<string, Record<string, string[]>>;
};

const isProviderClass = (v: string): v is ProviderClass =>
  v === 'may_log' || v === 'no_log' || v === 'eu_no_log';

const isEuVendorModelId = (modelId: string, allowedPrefixes: readonly string[]): boolean => {
  const lower = modelId.trim().toLowerCase();
  return allowedPrefixes.some((prefix) => {
    const p = prefix.trim().toLowerCase();
    return p.length > 0 && (lower.startsWith(`${p}/`) || lower.startsWith(`${p}-`) || lower.startsWith(`${p}:`));
  });
};

export class AiDataPolicy {
  constructor(
    readonly mode: PolicyMode,
    private readonly allowed: Record<DataClass, ProviderClass[]>,
    private readonly roleClass: Map<string, ProviderClass>,
    readonly euProfile: EuTenantProfileConfig = DEFAULT_EU_PROFILE,
  ) {}

  /**
   * Returns a policy scoped to a specific tenant context. EU tenants and tax-advisor
   * tenants (when `defaultForTaxAdvisorTenants` is true) are forced onto the strict
   * `eu_tenant` routing profile (EU-resident, no-training providers only).
   */
  forTenant(ctx: TenantAiRoutingContext): AiDataPolicy {
    const requireEu =
      Boolean(ctx.isEuTenant) ||
      (Boolean(ctx.isTaxAdvisor) && this.euProfile.defaultForTaxAdvisorTenants);
    if (!requireEu || this.mode === 'eu_tenant') {
      return this;
    }
    return new AiDataPolicy('eu_tenant', EU_STRICT, this.roleClass, {
      ...this.euProfile,
      enabled: true,
    });
  }

  /** Provider class of a models.yaml role; unknown roles are treated as may_log (fail closed). */
  providerClassOfRole(role: string): ProviderClass {
    return this.roleClass.get(role) ?? 'may_log';
  }

  /**
   * Provider class of one model of a role.
   * - Any free-tier id (`:free`, `openrouter/free`) is `may_log` even inside a paid or EU role.
   * - A model inside an `eu_no_log` role whose vendor prefix is not in the EU-resident allowlist
   *   is downgraded to `no_log` (non-EU), so a non-EU vendor can never slip into the EU path.
   */
  providerClassOfModel(role: string, modelId: string): ProviderClass {
    if (modelId.endsWith(':free') || modelId === 'openrouter/free') return 'may_log';
    const roleCls = this.providerClassOfRole(role);
    if (roleCls === 'eu_no_log' && !isEuVendorModelId(modelId, this.euProfile.allowedVendorPrefixes)) {
      return 'no_log';
    }
    return roleCls;
  }

  allowsModel(dataClass: DataClass, role: string, modelId: string): boolean {
    return this.allows(dataClass, this.providerClassOfModel(role, modelId));
  }

  /** Throws unless this exact model may see the data class. */
  assertModel(dataClass: DataClass, role: string, modelId: string): void {
    const providerClass = this.providerClassOfModel(role, modelId);
    if (!this.allows(dataClass, providerClass)) {
      throw new AiDataPolicyError(dataClass, role, providerClass, this.mode);
    }
  }

  /** Keeps the candidates whose model may see the data class, in order. */
  filterModels<T extends { id: string; role: string }>(dataClass: DataClass, items: T[]): T[] {
    return items.filter((item) => this.allowsModel(dataClass, item.role, item.id));
  }

  allows(dataClass: DataClass, providerClass: ProviderClass): boolean {
    return this.allowed[dataClass].includes(providerClass);
  }

  allowsRole(dataClass: DataClass, role: string): boolean {
    return this.allows(dataClass, this.providerClassOfRole(role));
  }

  assertRole(dataClass: DataClass, role: string): void {
    const providerClass = this.providerClassOfRole(role);
    if (!this.allows(dataClass, providerClass)) {
      throw new AiDataPolicyError(dataClass, role, providerClass, this.mode);
    }
  }

  /** Keeps the items whose role may see the data class, in order. */
  filterByRole<T extends { role: string }>(dataClass: DataClass, items: T[]): T[] {
    return items.filter((item) => this.allowsRole(dataClass, item.role));
  }
}

const isDataClass = (v: string): v is DataClass => (DATA_CLASSES as readonly string[]).includes(v);

/**
 * Role -> `data_policy` pairs of config/models.yaml. Light, targeted line parse (no YAML dependency),
 * like the other readers of that file: roles are keys at indent 2, `data_policy` at indent 4.
 */
export function readRoleDataPolicies(modelsYamlText: string): Map<string, string> {
  const out = new Map<string, string>();
  let inRoles = false;
  let role: string | null = null;
  for (const raw of modelsYamlText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (indent === 0) {
      inRoles = /^roles:\s*$/.test(trimmed);
      role = null;
      continue;
    }
    if (!inRoles) continue;
    if (indent === 2) {
      role = /^([A-Za-z0-9_]+):\s*$/.exec(trimmed)?.[1] ?? null;
      continue;
    }
    if (indent === 4 && role) {
      const m = /^data_policy:\s*(\S+)\s*$/.exec(trimmed);
      if (m) out.set(role, m[1]);
    }
  }
  return out;
}

function parseEuProfile(raw?: RawEuProfile): EuTenantProfileConfig {
  if (!raw) return { ...DEFAULT_EU_PROFILE };
  const prefixes = Array.isArray(raw.allowed_vendor_prefixes)
    ? raw.allowed_vendor_prefixes.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  const residency = Array.isArray(raw.allowed_residency)
    ? raw.allowed_residency.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  return {
    enabled: Boolean(raw.enabled),
    envFlag: typeof raw.env_flag === 'string' && raw.env_flag.trim() ? raw.env_flag.trim() : DEFAULT_EU_PROFILE.envFlag,
    defaultForTaxAdvisorTenants: raw.default_for_tax_advisor_tenants ?? true,
    allowServiceImprovementDefault: raw.allow_service_improvement_default ?? false,
    allowedResidency: residency.length > 0 ? residency : [...DEFAULT_EU_PROFILE.allowedResidency],
    allowedVendorPrefixes: prefixes.length > 0 ? prefixes : [...DEFAULT_EU_PROFILE.allowedVendorPrefixes],
  };
}

/**
 * Builds the policy from the two files' text (models.yaml, ai_data_policy.json).
 * - `euProfileOverride` (env ROXIRA_EU_TENANT_AI_PROFILE=true|1) or `eu_tenant_profile.enabled=true`
 *   forces the strict `eu_tenant` mode (EU-resident, no-training providers only).
 * - `modeOverride` (env ROXIRA_AI_DATA_MODE) wins over the file's `mode`.
 * - Anything unreadable or inconsistent yields the strict production rules (fail closed).
 */
export function parseAiDataPolicy(
  modelsYamlText: string,
  policyJsonText: string | null,
  modeOverride?: string,
  euProfileOverride?: boolean,
): AiDataPolicy {
  const roles = readRoleDataPolicies(modelsYamlText);
  let raw: RawPolicy | undefined;
  try {
    raw = policyJsonText ? (JSON.parse(policyJsonText) as RawPolicy) : undefined;
  } catch {
    raw = undefined;
  }
  const euProfile = parseEuProfile(raw?.eu_tenant_profile);
  const strict = (classes: Map<string, ProviderClass>) =>
    new AiDataPolicy('production', STRICT, classes, euProfile);

  const mapping = new Map<string, ProviderClass>();
  for (const [policy, cls] of Object.entries(raw?.provider_classes ?? {})) {
    if (isProviderClass(cls)) mapping.set(policy, cls);
  }
  const roleClass = new Map<string, ProviderClass>();
  for (const [role, dataPolicy] of roles) roleClass.set(role, mapping.get(dataPolicy) ?? 'may_log');
  if (!raw || !raw.modes) {
    return euProfileOverride ? new AiDataPolicy('eu_tenant', EU_STRICT, roleClass, { ...euProfile, enabled: true }) : strict(roleClass);
  }

  const euForced = Boolean(euProfileOverride) || euProfile.enabled;
  const requested = euForced ? 'eu_tenant' : (modeOverride || raw.mode || '').trim();
  const mode: PolicyMode | null =
    requested === 'test_accounts' || requested === 'production' || requested === 'eu_tenant' ? requested : null;
  const table = mode ? raw.modes[mode] : undefined;
  if (!mode || !table) {
    return euForced ? new AiDataPolicy('eu_tenant', EU_STRICT, roleClass, { ...euProfile, enabled: true }) : strict(roleClass);
  }

  const allowed = {} as Record<DataClass, ProviderClass[]>;
  for (const dataClass of DATA_CLASSES) {
    const list = table[dataClass];
    if (!Array.isArray(list)) {
      return euForced ? new AiDataPolicy('eu_tenant', EU_STRICT, roleClass, { ...euProfile, enabled: true }) : strict(roleClass);
    }
    allowed[dataClass] = list.filter(isProviderClass);
  }
  // Production and EU tenant modes can never be looser than their strict rules.
  if (mode === 'production') {
    for (const dataClass of DATA_CLASSES) allowed[dataClass] = allowed[dataClass].filter((p) => STRICT[dataClass].includes(p));
  } else if (mode === 'eu_tenant') {
    for (const dataClass of DATA_CLASSES) allowed[dataClass] = allowed[dataClass].filter((p) => EU_STRICT[dataClass].includes(p));
  }
  return new AiDataPolicy(mode, allowed, roleClass, { ...euProfile, enabled: euForced || mode === 'eu_tenant' });
}

const isTruthyEnv = (val?: string): boolean => {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

/** Loads the policy next to the first readable models.yaml of `modelsPaths`. */
export function loadAiDataPolicy(modelsPaths: string[], env: NodeJS.ProcessEnv = process.env): AiDataPolicy {
  const euOverride = isTruthyEnv(env.ROXIRA_EU_TENANT_AI_PROFILE);
  for (const modelsPath of modelsPaths) {
    let models: string;
    try {
      models = fs.readFileSync(modelsPath, 'utf8');
    } catch {
      continue;
    }
    let policy: string | null = null;
    try {
      policy = fs.readFileSync(path.join(path.dirname(modelsPath), 'ai_data_policy.json'), 'utf8');
    } catch {
      policy = null;
    }
    return parseAiDataPolicy(models, policy, env.ROXIRA_AI_DATA_MODE, euOverride);
  }
  return euOverride
    ? new AiDataPolicy('eu_tenant', EU_STRICT, new Map(), { ...DEFAULT_EU_PROFILE, enabled: true })
    : new AiDataPolicy('production', STRICT, new Map());
}

export { isDataClass };
