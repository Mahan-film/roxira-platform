import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  MENU_GROUPS,
  OPERATOR_ITEMS,
  QUICK_CREATE,
  SETTINGS_ITEM,
} from "./nav-menu.ts";

const appRoot = fileURLToPath(new URL("../app/app", import.meta.url));
const srcRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * پیمایش بازگشتی پوشه و یافتن تمام فایل‌های مطابق پسوند.
 */
function walk(dir: string, extFilter: (name: string) => boolean, fileList: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, extFilter, fileList);
    } else if (extFilter(entry)) {
      fileList.push(full);
    }
  }
  return fileList;
}

/**
 * جمع‌آوری تمام مسیرهای صفحات داخل `src/app/app`.
 */
function collectAppPages(dir: string, prefix: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("(") || entry.startsWith("@") || entry.startsWith("_")) continue;
      routes.push(...collectAppPages(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      routes.push(prefix === "" ? "/app" : prefix);
    }
  }
  return routes;
}

// فهرست صفحاتی که به دلایل ساختاری صریحاً توضیح داده شده‌اند
const EXPLAINED_ALLOWLIST: Record<string, string> = {
  "/app": "ریشه اپلیکیشن و نقطه ورود پس از احراز هویت / انتخاب سازمان.",
  "/app/accounting/cash-boxes": "صفحه تغییرمسیر قدیمی برای سازگاری backward-compatibility به /app/money?tab=cash-boxes.",
  "/app/treasury/cash-boxes": "صفحه تغییرمسیر قدیمی برای سازگاری backward-compatibility به /app/money?tab=cash-boxes.",
};

const allAppPages = collectAppPages(appRoot, "/app");
const tsFiles = walk(srcRoot, (name) => name.endsWith(".tsx") || name.endsWith(".ts"));
const fileContents = tsFiles.map((file) => ({
  path: file,
  content: readFileSync(file, "utf8"),
}));

test("all three target orphan pages now have inbound links", () => {
  const targetPages = ["/app/accounting/review", "/app/tax/kartable", "/app/damages"];
  for (const p of targetPages) {
    assert.ok(allAppPages.includes(p), `Target page ${p} does not exist on disk`);
    const menuLinks = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    const inMenu = menuLinks.includes(p);
    const inboundCodeRefs = fileContents.filter(
      (f) =>
        !f.path.includes(p + "/page.tsx") &&
        (f.content.includes(`"${p}"`) ||
          f.content.includes(`'${p}'`) ||
          f.content.includes(`\`${p}\``) ||
          f.content.includes(`\`${p}?`)),
    );
    assert.ok(
      inMenu || inboundCodeRefs.length > 0,
      `Expected target page ${p} to have an inbound link, but found none.`,
    );
  }
});

test("api tokens management page exists and is linked from settings", () => {
  assert.ok(allAppPages.includes("/app/settings/api-tokens"), "Page /app/settings/api-tokens does not exist");
  const inboundCodeRefs = fileContents.filter(
    (f) =>
      !f.path.includes("/app/settings/api-tokens/page.tsx") &&
      (f.content.includes(`"/app/settings/api-tokens"`) ||
        f.content.includes(`'/app/settings/api-tokens'`) ||
        f.content.includes("`" + "/app/settings/api-tokens" + "`")),
  );
  assert.ok(
    inboundCodeRefs.length > 0,
    "Expected /app/settings/api-tokens to be linked from settings or security, but found none.",
  );
});

test("every app page has an inbound link or is explicitly explained", () => {
  const menuHrefs = new Set([
    ...MENU_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    ...OPERATOR_ITEMS.map((i) => i.href),
    ...QUICK_CREATE.map((i) => i.href.split("?")[0]),
    SETTINGS_ITEM.href,
  ]);

  const unexplainedOrphans: string[] = [];

  for (const page of allAppPages) {
    if (EXPLAINED_ALLOWLIST[page]) {
      continue;
    }

    // بررسی صفحات با پارامتر دینامیک مانند /app/contracting/contracts/[id]
    if (page.includes("[id]")) {
      const basePrefix = page.substring(0, page.indexOf("[id]"));
      const hasDynamicRef = fileContents.some(
        (f) => !f.path.includes(page) && f.content.includes(basePrefix),
      );
      if (hasDynamicRef) continue;
    }

    // بررسی حضور در منو
    if (menuHrefs.has(page)) {
      continue;
    }

    // بررسی ارجاع در کد صفحات دیگر
    const hasCodeRef = fileContents.some(
      (f) =>
        !f.path.includes(page + "/page.tsx") &&
        (f.content.includes(`"${page}"`) ||
          f.content.includes(`'${page}'`) ||
          f.content.includes(`\`${page}\``) ||
          f.content.includes(`\`${page}?`)),
    );

    if (!hasCodeRef) {
      unexplainedOrphans.push(page);
    }
  }

  assert.deepEqual(
    unexplainedOrphans,
    [],
    `Found unlinked pages with no explanation: ${unexplainedOrphans.join(", ")}`,
  );
});
