import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "../..");

test("party-statement page uses formatMoneyRial, getPartyStatement, and downloadReport", () => {
  const pagePath = path.join(FRONTEND_ROOT, "src/app/app/reports/party-statement/page.tsx");
  const source = fs.readFileSync(pagePath, "utf8");

  assert.match(source, /formatMoneyRial/);
  assert.match(source, /getPartyStatement/);
  assert.match(source, /downloadReport\("party-statement"/);
  assert.match(source, /مانده در لحظه/);
  assert.match(source, /جدول سنی/);
});

test("party-statement route is wired in nav-menu.ts", () => {
  const navPath = path.join(FRONTEND_ROOT, "src/lib/nav-menu.ts");
  const source = fs.readFileSync(navPath, "utf8");

  assert.match(source, /href:\s*"\/app\/reports\/party-statement"/);
});
