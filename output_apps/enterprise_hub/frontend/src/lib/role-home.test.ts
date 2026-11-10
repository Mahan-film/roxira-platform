import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getRoleQuickActionDefs,
  isSalaryVisibleForRole,
} from "./role-home.ts";

describe("isSalaryVisibleForRole", () => {
  it("allows owner and hr", () => {
    assert.equal(isSalaryVisibleForRole("owner"), true);
    assert.equal(isSalaryVisibleForRole("hr"), true);
  });

  it("denies admin, accountant, sales, cheque_reviewer, read_only", () => {
    assert.equal(isSalaryVisibleForRole("admin"), false);
    assert.equal(isSalaryVisibleForRole("accountant"), false);
    assert.equal(isSalaryVisibleForRole("sales"), false);
    assert.equal(isSalaryVisibleForRole("cheque_reviewer"), false);
    assert.equal(isSalaryVisibleForRole("read_only"), false);
    assert.equal(isSalaryVisibleForRole(null), false);
    assert.equal(isSalaryVisibleForRole(undefined), false);
  });
});

describe("getRoleQuickActionDefs", () => {
  it("returns accounting-focused actions for accountant", () => {
    const actions = getRoleQuickActionDefs("accountant");
    assert.ok(actions.length >= 4);
    const hrefs = actions.map((a) => a.href);
    assert.ok(hrefs.includes("/app/accounting"));
    assert.ok(hrefs.includes("/app/accounting/reports"));
    assert.ok(hrefs.includes("/app/cheques"));
  });

  it("returns sales-focused actions for sales", () => {
    const actions = getRoleQuickActionDefs("sales");
    assert.ok(actions.length >= 4);
    const hrefs = actions.map((a) => a.href);
    assert.ok(hrefs.includes("/app/crm"));
    assert.ok(hrefs.includes("/app/invoicing"));
    assert.ok(hrefs.includes("/app/inventory"));
  });

  it("returns hr-focused actions for hr", () => {
    const actions = getRoleQuickActionDefs("hr");
    assert.ok(actions.length >= 4);
    const hrefs = actions.map((a) => a.href);
    assert.ok(hrefs.includes("/app/hr"));
    assert.ok(hrefs.includes("/app/hr/payroll"));
  });

  it("returns governance and settings actions for owner / admin", () => {
    const actions = getRoleQuickActionDefs("owner");
    assert.ok(actions.length >= 5);
    const hrefs = actions.map((a) => a.href);
    assert.ok(hrefs.includes("/app/settings/members"));
    assert.ok(hrefs.includes("/app/settings/policies"));
    assert.ok(hrefs.includes("/app/settings/audit"));
  });

  it("returns read-only overview actions for read_only and unknown roles", () => {
    const actions = getRoleQuickActionDefs("read_only");
    const hrefs = actions.map((a) => a.href);
    assert.ok(hrefs.includes("/app/accounting/reports"));
    assert.ok(hrefs.includes("/app/inventory"));
  });
});
