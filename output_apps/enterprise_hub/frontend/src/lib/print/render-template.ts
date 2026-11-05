/**
 * Renders the print templates' syntax (see print-templates/README.md): `{{a.b}}` escaped text,
 * `{{#if flag}}...{{/if}}`, `{{#each list}}...{{/each}}`. Blocks may nest. Inside `each` a name
 * resolves on the item first, then on the outer data. A missing value renders empty.
 */
type Scope = readonly unknown[];

const TAG = /\{\{\s*(#if|#each|\/if|\/each)?\s*([\w.]*)\s*\}\}/g;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function lookup(path: string, scope: Scope): unknown {
  const parts = path.split(".");
  for (const frame of scope) {
    let current: unknown = frame;
    let found = true;
    for (const part of parts) {
      if (current !== null && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        found = false;
        break;
      }
    }
    if (found) return current;
  }
  return undefined;
}

function isTruthy(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Index of the tag that closes the block opened just before `from`, counting nested blocks of its kind. */
function findClose(template: string, from: number, kind: "if" | "each"): { start: number; end: number } {
  const tags = new RegExp(TAG.source, "g");
  tags.lastIndex = from;
  let depth = 1;
  for (let match = tags.exec(template); match; match = tags.exec(template)) {
    if (match[1] === `#${kind}`) depth += 1;
    if (match[1] === `/${kind}`) depth -= 1;
    if (depth === 0) return { start: match.index, end: match.index + match[0].length };
  }
  throw new Error(`print template: {{#${kind}}} is not closed`);
}

function render(template: string, scope: Scope): string {
  const tags = new RegExp(TAG.source, "g");
  let output = "";
  let position = 0;
  for (let match = tags.exec(template); match; match = tags.exec(template)) {
    output += template.slice(position, match.index);
    position = match.index + match[0].length;
    const [, block, path] = match;
    if (block === "#if" || block === "#each") {
      const kind = block === "#if" ? "if" : "each";
      const close = findClose(template, position, kind);
      const body = template.slice(position, close.start);
      const value = lookup(path, scope);
      if (kind === "if") {
        if (isTruthy(value)) output += render(body, scope);
      } else if (Array.isArray(value)) {
        for (const item of value) output += render(body, [item, ...scope]);
      }
      position = close.end;
      tags.lastIndex = position;
    } else if (block) {
      throw new Error(`print template: stray {{${block}}}`);
    } else {
      output += escapeHtml(lookup(path, scope));
    }
  }
  return output + template.slice(position);
}

export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return render(template, [data]);
}
