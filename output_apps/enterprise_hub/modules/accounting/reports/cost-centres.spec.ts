import { costCentreTree } from './cost-centres';

const centres = [
  { id: 3, code: 'CC-120', name: 'Shop B', parentId: 1 },
  { id: 1, code: 'CC-100', name: 'Sales', parentId: null },
  { id: 2, code: 'CC-110', name: 'Shop A', parentId: 1 },
  { id: 4, code: 'CC-200', name: 'Admin', parentId: null },
  { id: 5, code: 'CC-111', name: 'Shop A till', parentId: 2 },
];

describe('costCentreTree', () => {
  it('orders depth-first by code and lists each subtree', () => {
    const tree = costCentreTree(centres)!;
    expect(tree.map((c) => [c.code, c.depth, c.parentCode])).toEqual([
      ['CC-100', 0, null],
      ['CC-110', 1, 'CC-100'],
      ['CC-111', 2, 'CC-110'],
      ['CC-120', 1, 'CC-100'],
      ['CC-200', 0, null],
    ]);
    expect(tree[0].memberIds.sort()).toEqual([1, 2, 3, 5]);
    expect(tree[1].memberIds.sort()).toEqual([2, 5]);
    expect(tree[4].memberIds).toEqual([4]);
  });

  it('returns one subtree for a root code, and null for an unknown code', () => {
    const tree = costCentreTree(centres, 'CC-110')!;
    expect(tree.map((c) => [c.code, c.depth])).toEqual([
      ['CC-110', 0],
      ['CC-111', 1],
    ]);
    expect(tree[0].parentCode).toBe('CC-100');
    expect(costCentreTree(centres, 'NOPE')).toBeNull();
  });

  it('lists every centre once even with a missing parent or a cycle', () => {
    const odd = [
      { id: 1, code: 'A', name: 'a', parentId: 99 },
      { id: 2, code: 'B', name: 'b', parentId: 3 },
      { id: 3, code: 'C', name: 'c', parentId: 2 },
    ];
    const tree = costCentreTree(odd)!;
    expect(tree.map((c) => c.code).sort()).toEqual(['A', 'B', 'C']);
    expect(tree.find((c) => c.code === 'A')!.depth).toBe(0);
  });
});
