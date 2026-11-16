import { strict as assert } from "node:assert";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  MENU_GROUPS,
  OPERATOR_ITEMS,
  QUICK_CREATE,
  SETTINGS_ITEM,
  activeHref,
  visibleGroups,
} from "./nav-menu.ts";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

/** Walk src/app and collect every page route; (group) segments are stripped, [x] kept literal. */
function collectRoutes(dir: string, prefix: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("(")) continue; // route group, not part of the URL
      if (entry.startsWith("[") || entry.startsWith("@") || entry.startsWith("_")) continue;
      routes.push(...collectRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      routes.push(prefix === "" ? "/" : prefix);
    }
  }
  return routes;
}

const routes = collectRoutes(appDir, "");

const leafHrefs = MENU_GROUPS.flatMap((group) => group.items.map((item) => item.href));
const quickCreatePaths = QUICK_CREATE.map((entry) => entry.href.split("?")[0]);

test("menu has exactly the seven hubs in the specified order (WAVE 14 reset)", () => {
  assert.deepEqual(
    MENU_GROUPS.map((group) => group.id),
    [
      "home",
      "sales",
      "purchase-stock",
      "money",
      "people",
      "accounting-tax",
      "reports",
    ],
  );
});

test("group labels match the brief exactly", () => {
  assert.deepEqual(
    MENU_GROUPS.map((group) => group.label),
    [
      "خانه",
      "فروش",
      "خرید و انبار",
      "پول",
      "کارکنان",
      "حسابداری و مالیات",
      "گزارش‌ها",
    ],
  );
});

test("every leaf href points to an existing page (with /app/money built in T107)", () => {
  for (const href of leafHrefs) {
    if (href === "/app/money") continue; // built by L3 in T107
    assert.ok(
      routes.includes(href),
      `href ${href} has no page.tsx; available: ${routes.filter((r) => r.startsWith(href.split("/")[1])).join(", ")}`,
    );
  }
});

test("footer settings item exists and points to /app/settings", () => {
  assert.equal(SETTINGS_ITEM.href, "/app/settings");
  assert.ok(routes.includes("/app/settings"), "/app/settings has no page.tsx");
});

test("every QUICK_CREATE href path points to an existing page", () => {
  for (const path of quickCreatePaths) {
    assert.ok(routes.includes(path), `path ${path} has no page.tsx`);
  }
});

test("no duplicate hrefs across groups and operator items", () => {
  const all = [...leafHrefs, ...OPERATOR_ITEMS.map((item) => item.href), SETTINGS_ITEM.href];
  assert.equal(new Set(all).size, all.length);
});

test("no duplicate group ids or leaf labels", () => {
  const ids = MENU_GROUPS.map((group) => group.id);
  assert.equal(new Set(ids).size, ids.length);
  const labels = [
    ...MENU_GROUPS.flatMap((group) => group.items.map((item) => item.label)),
    SETTINGS_ITEM.label,
  ];
  assert.equal(new Set(labels).size, labels.length);
});

test("leaves have no nested items property", () => {
  for (const group of MENU_GROUPS) {
    for (const item of group.items) {
      assert.ok(!("items" in item));
    }
  }
});

test("no Latin letters in any label", () => {
  const labels = [
    ...MENU_GROUPS.map((group) => group.label),
    ...MENU_GROUPS.flatMap((group) => group.items.map((item) => item.label)),
    ...OPERATOR_ITEMS.map((item) => item.label),
    ...QUICK_CREATE.map((entry) => entry.label),
    SETTINGS_ITEM.label,
  ];
  for (const label of labels) {
    assert.ok(!/[A-Za-z]/.test(label), `label contains Latin letters: ${label}`);
  }
});

test("visibleGroups with can=()=>true keeps everything except assistant when disabled", () => {
  const full = visibleGroups(() => true, { assistantEnabled: true });
  const hrefs = full.flatMap((group) => group.items.map((item) => item.href));
  assert.ok(hrefs.includes("/app/assistant"));
  const withoutAssistant = visibleGroups(() => true, { assistantEnabled: false });
  const hrefs2 = withoutAssistant.flatMap((group) => group.items.map((item) => item.href));
  assert.ok(!hrefs2.includes("/app/assistant"));
  // everything else stays
  for (const href of hrefs) {
    if (href === "/app/assistant") continue;
    assert.ok(hrefs2.includes(href), `${href} missing with assistant disabled`);
  }
});

test("visibleGroups with can=()=>false keeps only /app", () => {
  const groups = visibleGroups(() => false, { assistantEnabled: true });
  const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
  assert.deepEqual(hrefs.sort(), ["/app"]);
});

test("visibleGroups only ever returns hrefs present in MENU_GROUPS", () => {
  const known = new Set(MENU_GROUPS.flatMap((group) => group.items.map((item) => item.href)));
  for (const assistantEnabled of [true, false]) {
    for (const groups of [
      visibleGroups(() => true, { assistantEnabled }),
      visibleGroups(() => false, { assistantEnabled }),
    ]) {
      for (const group of groups) {
        for (const item of group.items) {
          assert.ok(known.has(item.href), `unexpected href ${item.href}`);
        }
      }
    }
  }
});

test("a role with only crm read sees exactly /app and /app/crm", () => {
  const groups = visibleGroups((m, a) => m === "crm" && a === "read", { assistantEnabled: true });
  const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
  assert.deepEqual(hrefs.sort(), ["/app", "/app/crm"]);
});

test("activeHref matches the longest href, with /app exact-match only", () => {
  const hrefs = [...MENU_GROUPS.flatMap((group) => group.items.map((item) => item.href)), SETTINGS_ITEM.href];
  assert.equal(activeHref("/app/accounting/vouchers", hrefs), "/app/accounting/vouchers");
  assert.equal(activeHref("/app/accounting/chart", hrefs), "/app/accounting/chart");
  assert.equal(activeHref("/app/hr/payroll", hrefs), "/app/hr/payroll");
  assert.equal(activeHref("/app/hr/contracts/5/allowances", hrefs), "/app/hr");
  assert.equal(activeHref("/app/settings/security", hrefs), "/app/settings");
  assert.equal(activeHref("/app", hrefs), "/app");
  assert.equal(activeHref("/app/unknown", hrefs), null);
});

test("the report builder has a menu entry and its page exists", () => {
  const leaf = MENU_GROUPS.flatMap((group) => group.items).find((item) => item.href === "/app/accounting/report-builder");
  assert.ok(leaf);
  assert.equal(leaf.module, "accounting");
  assert.ok(routes.includes("/app/accounting/report-builder"));
  assert.equal(activeHref("/app/accounting/report-builder", leafHrefs), "/app/accounting/report-builder");
});
