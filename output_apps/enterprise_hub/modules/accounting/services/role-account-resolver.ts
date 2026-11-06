import { AccountLevel, AccountType } from '../enums/accounting.enum';

/**
 * A ledger account a posting role needs. Used by the invoice and stock posting code to find the
 * tenant's own account for a role (receivable, input VAT, ...) in whatever chart it has.
 */
export interface RoleAccountSpec {
  /** Default code, used to break ties and as the code a new account is created under. */
  code: string;
  name: string;
  accountType: AccountType;
  /** Name fragments any of which makes an account a candidate. */
  match: string[];
  /** Name fragments that rule an account out (e.g. «اسناد»: notes are not trade balances). */
  exclude?: string[];
}

export interface ChartAccountLike {
  code: string;
  name: string;
  accountType: AccountType;
  level?: AccountLevel | null;
}

export type RoleAccountDecision =
  | { action: 'use'; code: string }
  | { action: 'create'; code: string; name: string; accountType: AccountType };

/** Arabic yeh/kaf to Persian, zero-width non-joiner removed, so spelling variants still match. */
function normalize(text: string): string {
  return text.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, '');
}

function isHeader(account: ChartAccountLike): boolean {
  return account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL;
}

function nameMatches(name: string, spec: RoleAccountSpec): boolean {
  const text = normalize(name);
  return (
    spec.match.some((fragment) => text.includes(normalize(fragment))) &&
    !(spec.exclude ?? []).some((fragment) => text.includes(normalize(fragment)))
  );
}

/**
 * Which account a role posts to, without touching the database.
 *
 * 1. Candidates: postable accounts (not a group or kol header) of the spec's type whose name has a
 *    `match` fragment and no `exclude` fragment. Several candidates: the default code if it is one,
 *    else the lowest code, so the answer never depends on list order.
 * 2. No candidate, default code free: create the account under its default code.
 * 3. No candidate, but the default code exists under a name that does not fit the role (1401
 *    «پیش‌پرداخت خرید و اجاره» is not input VAT): never reuse it. Create the account under the next
 *    free code after the default, within the same leading-digit group (1401 -> 1402 ... 1999).
 *
 * `taken` holds codes already claimed by earlier creations in the same plan.
 */
export function decideRoleAccount(
  accounts: readonly ChartAccountLike[],
  spec: RoleAccountSpec,
  taken: ReadonlySet<string> = new Set(),
): RoleAccountDecision {
  const candidates = accounts
    .filter((a) => !isHeader(a) && a.accountType === spec.accountType && nameMatches(a.name, spec))
    .map((a) => a.code)
    .sort(compareCodes);
  if (candidates.length > 0) {
    return { action: 'use', code: candidates.includes(spec.code) ? spec.code : candidates[0] };
  }
  const used = new Set<string>([...accounts.map((a) => a.code), ...taken]);
  const create = (code: string): RoleAccountDecision => ({
    action: 'create',
    code,
    name: spec.name,
    accountType: spec.accountType,
  });
  if (!used.has(spec.code)) return create(spec.code);
  const start = Number(spec.code);
  const end = Math.floor(start / 1000) * 1000 + 999;
  for (let next = start + 1; next <= end; next += 1) {
    if (!used.has(String(next))) return create(String(next));
  }
  throw new Error(`No free account code after ${spec.code} for «${spec.name}».`);
}

function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
