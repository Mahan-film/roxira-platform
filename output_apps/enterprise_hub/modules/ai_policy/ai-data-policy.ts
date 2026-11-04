import * as fs from 'fs';
import * as path from 'path';

/** What a piece of data is; see docs/ops/AI_DATA_POLICY.md. */
export type DataClass = 'public' | 'tenant-business' | 'personal';
/** Whether the provider behind a model role may log or train on prompts. */
export type ProviderClass = 'may_log' | 'no_log';
export type PolicyMode = 'test_accounts' | 'production';

export const DATA_CLASSES: readonly DataClass[] = ['public', 'tenant-business', 'personal'];

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

/** The strictest rules; used whenever the policy file is missing or invalid. */
const STRICT: Record<DataClass, ProviderClass[]> = {
  public: ['may_log', 'no_log'],
  'tenant-business': ['no_log'],
  personal: ['no_log'],
};

type RawPolicy = {
  mode?: string;
  provider_classes?: Record<string, string>;
  modes?: Record<string, Record<string, string[]>>;
};

export class AiDataPolicy {
  constructor(
    readonly mode: PolicyMode,
    private readonly allowed: Record<DataClass, ProviderClass[]>,
    private readonly roleClass: Map<string, ProviderClass>,
  ) {}

  /** Provider class of a models.yaml role; unknown roles are treated as may_log (fail closed). */
  providerClassOfRole(role: string): ProviderClass {
    return this.roleClass.get(role) ?? 'may_log';
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

/**
 * Builds the policy from the two files' text (models.yaml, ai_data_policy.json). `modeOverride` (env ROXIRA_AI_DATA_MODE) wins over the
 * file. Anything unreadable or inconsistent yields the strict production rules.
 */
export function parseAiDataPolicy(modelsYamlText: string, policyJsonText: string | null, modeOverride?: string): AiDataPolicy {
  const roles = readRoleDataPolicies(modelsYamlText);
  const strict = (classes: Map<string, ProviderClass>) => new AiDataPolicy('production', STRICT, classes);
  let raw: RawPolicy | undefined;
  try {
    raw = policyJsonText ? (JSON.parse(policyJsonText) as RawPolicy) : undefined;
  } catch {
    raw = undefined;
  }
  const mapping = new Map<string, ProviderClass>();
  for (const [policy, cls] of Object.entries(raw?.provider_classes ?? {})) {
    if (cls === 'may_log' || cls === 'no_log') mapping.set(policy, cls);
  }
  const roleClass = new Map<string, ProviderClass>();
  for (const [role, dataPolicy] of roles) roleClass.set(role, mapping.get(dataPolicy) ?? 'may_log');
  if (!raw || !raw.modes) return strict(roleClass);

  const requested = (modeOverride || raw.mode || '').trim();
  const mode: PolicyMode | null = requested === 'test_accounts' || requested === 'production' ? requested : null;
  const table = mode ? raw.modes[mode] : undefined;
  if (!mode || !table) return strict(roleClass);

  const allowed = {} as Record<DataClass, ProviderClass[]>;
  for (const dataClass of DATA_CLASSES) {
    const list = table[dataClass];
    if (!Array.isArray(list)) return strict(roleClass);
    allowed[dataClass] = list.filter((v): v is ProviderClass => v === 'may_log' || v === 'no_log');
  }
  // Production can never be looser than the strict rules.
  if (mode === 'production') {
    for (const dataClass of DATA_CLASSES) allowed[dataClass] = allowed[dataClass].filter((p) => STRICT[dataClass].includes(p));
  }
  return new AiDataPolicy(mode, allowed, roleClass);
}

/** Loads the policy next to the first readable models.yaml of `modelsPaths`. */
export function loadAiDataPolicy(modelsPaths: string[], env: NodeJS.ProcessEnv = process.env): AiDataPolicy {
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
    return parseAiDataPolicy(models, policy, env.ROXIRA_AI_DATA_MODE);
  }
  return new AiDataPolicy('production', STRICT, new Map());
}

export { isDataClass };
