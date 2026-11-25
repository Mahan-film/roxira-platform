import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { invoiceOutstanding, invoiceParty, selectionTotal, toggleSelection } from "./invoice-list.ts";

const party = (overrides: Record<string, unknown> = {}) =>
  ({
    direction: "SALE",
    customerId: 12,
    buyerInfo: { name: "  فروشگاه نیلوفر  " },
    sellerInfo: { name: "پخش البرز" },
    ...overrides,
  }) as unknown as Parameters<typeof invoiceParty>[0];

test("a sale shows the buyer, linked to its CRM record", () => {
  assert.deepEqual(invoiceParty(party()), {
    name: "فروشگاه نیلوفر",
    hint: null,
    href: "/app/crm?lead=12",
  });
});

test("a purchase shows the seller and has no customer link", () => {
  assert.deepEqual(invoiceParty(party({ direction: "PURCHASE" })), {
    name: "پخش البرز",
    hint: null,
    href: null,
  });
});

test("a party without a name falls back to its national id, never a made-up label", () => {
  const unnamed = party({ customerId: null, buyerInfo: { name: " ", nationalId: "0012345678" } });
  assert.deepEqual(invoiceParty(unnamed), { name: null, hint: "0012345678", href: null });
  const bare = party({ customerId: null, buyerInfo: { name: "" } });
  assert.deepEqual(invoiceParty(bare), { name: null, hint: null, href: null });
});

test("outstanding is the amount while issued, zero when paid, none for drafts and cancels", () => {
  const row = (status: string) => ({ status, rialAmount: 18_500_000 }) as Parameters<typeof invoiceOutstanding>[0];
  assert.equal(invoiceOutstanding(row("ISSUED")), 18_500_000);
  assert.equal(invoiceOutstanding(row("PAID")), 0);
  assert.equal(invoiceOutstanding(row("DRAFT")), null);
  assert.equal(invoiceOutstanding(row("CANCELLED")), null);
});

test("selection total sums the selected rows in rials", () => {
  const rows = [
    { id: "a", status: "ISSUED", rialAmount: 12_000_000 },
    { id: "b", status: "PAID", rialAmount: 3_250_000 },
    { id: "c", status: "ISSUED", rialAmount: 40_000_000 },
  ] as Parameters<typeof selectionTotal>[0];
  assert.deepEqual(selectionTotal(rows, new Set(["a", "c"])), { count: 2, total: 52_000_000 });
  assert.deepEqual(selectionTotal(rows, new Set()), { count: 0, total: 0 });
});

test("toggle selects one row, or all visible rows, and clears them again", () => {
  const visible = ["a", "b"];
  let selected = toggleSelection(new Set(), visible, "a");
  assert.deepEqual([...selected], ["a"]);
  selected = toggleSelection(selected, visible, null);
  assert.deepEqual([...selected].sort(), ["a", "b"]);
  selected = toggleSelection(selected, visible, null);
  assert.deepEqual([...selected], []);
  const kept = toggleSelection(new Set(["z"]), visible, null);
  assert.deepEqual([...kept].sort(), ["a", "b", "z"]);
});

test("invoicing list & page satisfy RTL logical CSS, WCAG contrast/HTML, and 375px layout guards", () => {
  const tableSrc = fs.readFileSync(
    new URL("../components/invoicing/invoice-list-table.tsx", import.meta.url),
    "utf8",
  );
  const pageSrc = fs.readFileSync(
    new URL("../app/app/invoicing/page.tsx", import.meta.url),
    "utf8",
  );
  const rowMenuSrc = fs.readFileSync(
    new URL("../components/ui/row-actions-menu.tsx", import.meta.url),
    "utf8",
  );

  // Zero physical directional classes in list page & table
  const physicalRegex = /\b(ml-\d|mr-\d|pl-\d|pr-\d|text-left|text-right)\b/g;
  assert.deepEqual(tableSrc.match(physicalRegex) ?? [], []);
  assert.deepEqual(pageSrc.match(physicalRegex) ?? [], []);

  // Desktop table has horizontal overflow guard; mobile uses card list below sm
  assert.ok(tableSrc.includes("hidden overflow-x-auto sm:block"));
  assert.ok(tableSrc.includes("sm:hidden"));

  // WCAG AA contrast & valid HTML structure
  assert.ok(!tableSrc.includes("text-[11px]"), "Moadian badges should stay >= 12px (text-xs)");
  assert.ok(tableSrc.includes("text-red-700"));
  assert.ok(!/<Link\b[^>]*>\s*<Button\b/.test(pageSrc), "Do not nest <Button> inside <Link>");
  for (const m of tableSrc.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
    assert.ok(!m[0].includes("<div"), "Do not nest <div> inside <button>");
  }
  assert.ok(
    !tableSrc.includes('<div className="flex flex-col gap-0.5'),
    "MoadianStatusBadge should use inline-flex span so it is valid inside button",
  );

  // Mobile card parity & >= 44px touch targets
  assert.ok(tableSrc.includes("party.hint ? faDigits(party.hint)"));
  assert.ok(tableSrc.includes("مانده:"));
  assert.ok(pageSrc.includes("h-11 sm:h-9"));
  assert.ok(pageSrc.includes("min-h-11 sm:min-h-8"));
  assert.ok(rowMenuSrc.includes("size-11") && rowMenuSrc.includes("sm:size-8"));
});
