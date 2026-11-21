/**
 * T167: A2UI spike for assistant answers.
 *
 * - Strict whitelist catalog: `table`, `kpi_tile`, `chart`, `confirm_form`.
 * - Unknown components are rejected fail-closed (`A2UI_UNKNOWN_COMPONENT`).
 * - Server-side binding from tool results; masked fields are redacted both
 *   from the model payload (`prepareModelSafeToolResult`) and in the bound
 *   surface output so masked values never leak to the model or UI.
 * - Gated behind a flag on the Home hub only (`home_hub`).
 */

export const A2UI_WHITELIST_COMPONENTS = [
  'table',
  'kpi_tile',
  'chart',
  'confirm_form',
] as const;

export type A2UIComponentType = (typeof A2UI_WHITELIST_COMPONENTS)[number];

export const A2UI_MASK_PLACEHOLDER = '***MASKED***';

export class A2UIError extends Error {
  constructor(
    public readonly code:
      | 'A2UI_UNKNOWN_COMPONENT'
      | 'A2UI_DISABLED'
      | 'A2UI_SURFACE_NOT_ALLOWED',
    message: string,
  ) {
    super(message);
    this.name = 'A2UIError';
  }
}

export interface A2UIRawNode {
  id: string;
  type: string;
  title?: string;
  /** Server-side dot-path into toolResult (e.g. "rows", "kpis.revenue"). */
  bind?: string;
  props?: Record<string, unknown>;
}

export interface A2UIRawSurface {
  surfaceId: string;
  components: A2UIRawNode[];
}

export interface A2UIBoundNode {
  id: string;
  type: A2UIComponentType;
  title?: string;
  data: unknown;
  props: Record<string, unknown>;
}

export interface A2UIBoundSurface {
  surfaceId: string;
  components: A2UIBoundNode[];
}

export interface A2UIContext {
  surface: string;
  a2uiHomeHubEnabled: boolean;
}

const WHITELIST_SET = new Set<string>(A2UI_WHITELIST_COMPONENTS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively replaces any key in `maskedFields` with `A2UI_MASK_PLACEHOLDER`.
 * Used both before sending tool results to the LLM (so masked values never
 * appear in the model payload) and when binding server-side surface data.
 */
export function maskSensitiveFields<T>(
  value: T,
  maskedFields: ReadonlySet<string>,
): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveFields(item, maskedFields)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (maskedFields.has(k)) {
        out[k] = A2UI_MASK_PLACEHOLDER;
      } else {
        out[k] = maskSensitiveFields(v, maskedFields);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Prepares a tool result payload safe to pass to the LLM: every field in
 * `maskedFields` is replaced with `***MASKED***`.
 */
export function prepareModelSafeToolResult(
  toolResult: Record<string, unknown>,
  maskedFields: readonly string[],
): Record<string, unknown> {
  return maskSensitiveFields(toolResult, new Set(maskedFields));
}

function resolveDotPath(
  source: Record<string, unknown>,
  dotPath?: string,
): unknown {
  if (!dotPath) return null;
  const parts = dotPath.split('.').filter(Boolean);
  let cur: unknown = source;
  for (const part of parts) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      return null;
    }
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, part)) {
      return null;
    }
    cur = cur[part];
  }
  return cur;
}

/**
 * Validates an A2UI surface against the strict whitelist catalog, enforces
 * the Home-hub-only feature flag, and binds all data server-side from the
 * masked tool result.
 */
export function validateAndBindA2UISurface(params: {
  rawSurface: A2UIRawSurface;
  toolResult: Record<string, unknown>;
  maskedFields: readonly string[];
  context: A2UIContext;
}): A2UIBoundSurface {
  const { rawSurface, toolResult, maskedFields, context } = params;

  if (!context.a2uiHomeHubEnabled) {
    throw new A2UIError(
      'A2UI_DISABLED',
      'A2UI surfaces are disabled for this tenant/session.',
    );
  }
  if (context.surface !== 'home_hub') {
    throw new A2UIError(
      'A2UI_SURFACE_NOT_ALLOWED',
      `A2UI is only enabled on home_hub (received "${context.surface}").`,
    );
  }

  const maskSet = new Set(maskedFields);
  const safeToolResult = maskSensitiveFields(toolResult, maskSet);

  const boundComponents: A2UIBoundNode[] = rawSurface.components.map((node) => {
    if (!WHITELIST_SET.has(node.type)) {
      throw new A2UIError(
        'A2UI_UNKNOWN_COMPONENT',
        `Unknown A2UI component type "${node.type}". Allowed: ${A2UI_WHITELIST_COMPONENTS.join(', ')}.`,
      );
    }
    const boundData = resolveDotPath(safeToolResult, node.bind);
    const safeProps = maskSensitiveFields(node.props ?? {}, maskSet);
    return {
      id: node.id,
      type: node.type as A2UIComponentType,
      title: node.title,
      data: boundData,
      props: safeProps,
    };
  });

  return {
    surfaceId: rawSurface.surfaceId,
    components: boundComponents,
  };
}
