/**
 * Chart of accounts as a tree, built from the account codes.
 *
 * The API returns a flat list; an account's parent is the account with the
 * longest code that is a proper prefix of its own (1101 sits under 11, which
 * sits under 1). Roll-up balances add every descendant to the account itself.
 */
import type { ChartOfAccount } from "@/types/accounting";

export interface AccountNode {
  account: ChartOfAccount;
  depth: number;
  children: AccountNode[];
  /** Own balance plus all descendants. */
  rollup: number;
  /** Set when the placement looks wrong and a person should check it. */
  review: string | null;
}

const RECEIVABLE = /دریافتنی|مطالبات|receivable/i;
const BANK = /بانک|bank/i;

export function buildAccountTree(accounts: ChartOfAccount[]): AccountNode[] {
  // Plain string order keeps every code right after its prefix (1, 11, 1101, 2).
  const sorted = [...accounts].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const nodes = sorted.map<AccountNode>((account) => ({
    account,
    depth: 0,
    children: [],
    rollup: account.balance,
    review: null,
  }));
  const roots: AccountNode[] = [];
  // Sorted by code, an account's parent is always the nearest earlier prefix.
  const stack: AccountNode[] = [];
  for (const node of nodes) {
    while (stack.length && !isParent(stack[stack.length - 1].account.code, node.account.code)) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
      if (BANK.test(node.account.name) && ancestorsMatch(stack, RECEIVABLE)) {
        node.review = "حساب بانکی زیر حساب‌های دریافتنی قرار گرفته؛ جایگاه آن را بررسی کنید.";
      }
    } else {
      roots.push(node);
    }
    stack.push(node);
  }
  for (const root of roots) sumUp(root);
  return roots;
}

function isParent(parentCode: string, code: string): boolean {
  return code.length > parentCode.length && code.startsWith(parentCode);
}

function ancestorsMatch(stack: AccountNode[], pattern: RegExp): boolean {
  return stack.some((n) => pattern.test(n.account.name));
}

function sumUp(node: AccountNode): number {
  node.rollup = node.account.balance + node.children.reduce((sum, c) => sum + sumUp(c), 0);
  return node.rollup;
}

/** Depth-first list of the nodes that are visible given the collapsed set. */
export function visibleNodes(roots: AccountNode[], collapsed: ReadonlySet<string>): AccountNode[] {
  const out: AccountNode[] = [];
  const walk = (node: AccountNode) => {
    out.push(node);
    if (!collapsed.has(node.account.code)) node.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

export function countReview(roots: AccountNode[]): number {
  let n = 0;
  const walk = (node: AccountNode) => {
    if (node.review) n += 1;
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return n;
}
