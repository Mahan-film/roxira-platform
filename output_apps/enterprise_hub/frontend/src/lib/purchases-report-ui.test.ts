import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "../..");

test("purchases report page uses formatMoneyRial, getPurchasesReport, and export URL", () => {
  const pagePath = path.join(FRONTEND_ROOT, "src/app/app/reports/purchases/page.tsx");
  const source = fs.readFileSync(pagePath, "utf8");

  assert.match(source, /formatMoneyRial/);
  assert.match(source, /getPurchasesReport/);
  assert.match(source, /reports\/purchases\?/);
});

test("purchases report route is wired in nav-menu.ts", () => {
  const navPath = path.join(FRONTEND_ROOT, "src/lib/nav-menu.ts");
  const source = fs.readFileSync(navPath, "utf8");

  assert.match(source, /href:\s*"\/app\/reports\/purchases"/);
});
