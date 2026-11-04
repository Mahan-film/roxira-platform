/** A cost centre as the tree sees it. */
export interface CentreNode {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
}

/** A cost centre in display order, with the ids whose lines roll up into it (itself included). */
export interface OrderedCentre extends CentreNode {
  parentCode: string | null;
  depth: number;
  memberIds: number[];
}

/**
 * Orders cost centres depth-first by code, each followed by its children, and lists for each centre
 * the ids of its whole subtree. A centre whose parent is missing is treated as a root; a cycle is cut
 * where it is found, so every centre appears exactly once. With `rootCode`, only that centre's
 * subtree is returned (depth counted from it); null when no centre has that code.
 */
export function costCentreTree(centres: readonly CentreNode[], rootCode?: string): OrderedCentre[] | null {
  const byId = new Map(centres.map((centre) => [centre.id, centre]));
  const children = new Map<number | null, CentreNode[]>();
  for (const centre of centres) {
    const parent = centre.parentId !== null && byId.has(centre.parentId) ? centre.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), centre]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.code.localeCompare(b.code));
  }

  const ordered: OrderedCentre[] = [];
  const visited = new Set<number>();
  const visit = (centre: CentreNode, depth: number, parentCode: string | null): number[] => {
    visited.add(centre.id);
    const entry: OrderedCentre = { ...centre, parentCode, depth, memberIds: [centre.id] };
    ordered.push(entry);
    for (const child of children.get(centre.id) ?? []) {
      if (!visited.has(child.id)) {
        entry.memberIds.push(...visit(child, depth + 1, centre.code));
      }
    }
    return entry.memberIds;
  };

  if (rootCode !== undefined) {
    const root = centres.find((centre) => centre.code === rootCode);
    if (!root) {
      return null;
    }
    const parent = root.parentId !== null ? byId.get(root.parentId) : undefined;
    visit(root, 0, parent?.code ?? null);
    return ordered;
  }
  for (const root of children.get(null) ?? []) {
    visit(root, 0, null);
  }
  // Centres only reachable through a cycle: start from the lowest code so each is still listed.
  for (const centre of [...centres].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!visited.has(centre.id)) {
      visit(centre, 0, null);
    }
  }
  return ordered;
}
