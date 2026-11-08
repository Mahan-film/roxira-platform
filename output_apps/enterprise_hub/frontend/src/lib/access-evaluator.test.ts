import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateClientAccess,
  formatRialDisplay,
  getEffectiveFieldVisibility,
  getEffectiveScope,
  parseRialAmount,
} from "./access-evaluator.ts";

test("parseRialAmount handles Latin and Persian numbers and delimiters", () => {
  assert.equal(parseRialAmount(500000), BigInt(500000));
  assert.equal(parseRialAmount("1,250,000"), BigInt(1250000));
  assert.equal(parseRialAmount("۱۲۵۰۰۰۰"), BigInt(1250000));
  assert.equal(parseRialAmount("۱٬۵۰۰٬۰۰۰"), BigInt(1500000));
  assert.equal(parseRialAmount("invalid"), BigInt(0));
  assert.equal(parseRialAmount(-100), BigInt(0));
});

test("formatRialDisplay formats amount with Persian separators and Rial unit", () => {
  assert.match(formatRialDisplay(1000000), /ریال/);
  assert.match(formatRialDisplay(1000000), /۱[٬,]۰۰۰[٬,]۰۰۰/);
});

test("salary visibility: owner and hr can view; accountant and sales are refused", () => {
  const ownerVis = getEffectiveFieldVisibility("owner");
  assert.equal(ownerVis.salary, true);
  assert.equal(ownerVis.cost, true);
  assert.equal(ownerVis.margin, true);

  const hrVis = getEffectiveFieldVisibility("hr");
  assert.equal(hrVis.salary, true);
  assert.equal(hrVis.cost, false);

  const accountantVis = getEffectiveFieldVisibility("accountant");
  assert.equal(accountantVis.salary, false);
  assert.equal(accountantVis.cost, true);

  const salesVis = getEffectiveFieldVisibility("sales");
  assert.equal(salesVis.salary, false);
  assert.equal(salesVis.cost, false);
  assert.equal(salesVis.margin, true);
});

test("evaluateClientAccess: denies un-entitled module", () => {
  const res = evaluateClientAccess({
    roleKey: "accountant",
    entitledModules: ["accounting"], // invoicing not entitled
    module: "invoicing",
    action: "read",
  });
  assert.equal(res.allowed, false);
  assert.equal(res.code, "MODULE_NOT_ENTITLED");
  assert.match(res.reasonFa, /اشتراک فعال/);
});

test("evaluateClientAccess: core modules are always entitled", () => {
  const res = evaluateClientAccess({
    roleKey: "admin",
    entitledModules: [], // empty
    module: "audit",
    action: "read",
  });
  assert.equal(res.allowed, true);
});

test("evaluateClientAccess: denies forbidden action", () => {
  const res = evaluateClientAccess({
    roleKey: "sales",
    entitledModules: ["accounting", "invoicing"],
    module: "accounting",
    action: "post",
  });
  assert.equal(res.allowed, false);
  assert.equal(res.code, "FORBIDDEN_ACTION");
  assert.match(res.reasonFa, /مجوز/);
});

test("evaluateClientAccess: denies sensitive field when role is hidden", () => {
  const res = evaluateClientAccess({
    roleKey: "read_only",
    entitledModules: ["hr"],
    module: "hr",
    action: "read",
    field: "salary",
  });
  assert.equal(res.allowed, false);
  assert.equal(res.code, "FORBIDDEN_FIELD");
  assert.match(res.reasonFa, /حقوق و دستمزد/);
});

test("evaluateClientAccess: allows salary for hr role", () => {
  const res = evaluateClientAccess({
    roleKey: "hr",
    entitledModules: ["hr"],
    module: "hr",
    action: "read",
    field: "salary",
  });
  assert.equal(res.allowed, true);
});

test("evaluateClientAccess: denies scope violation when user is branchScoped", () => {
  const res = evaluateClientAccess({
    roleKey: "sales",
    member: {
      id: "mem-1",
      userId: "u-1",
      roleKey: "sales",
      customRoleId: null,
      branchId: "branch-tehran",
      departmentId: null,
      branchScoped: true,
      status: "ACTIVE",
      createdAt: "",
      displayName: "تست",
      loginEmail: null,
      username: "test",
      phone: null,
      managed: true,
    },
    entitledModules: ["invoicing"],
    module: "invoicing",
    action: "create",
    branchId: "branch-shiraz",
  });
  assert.equal(res.allowed, false);
  assert.equal(res.code, "FORBIDDEN_SCOPE");
  assert.match(res.summaryFa, /محدوده شعبه/);
});

test("evaluateClientAccess: enforces amount limit on custom role", () => {
  const customRole = {
    id: "role-1",
    name: "فروشنده محدود",
    permissions: ["invoicing:create", "invoicing:read"],
    amountLimits: {
      "invoicing:create": "10000000", // 10,000,000 Rials
    },
  };

  // Within limit: allowed
  const ok = evaluateClientAccess({
    roleKey: "custom",
    customRole,
    entitledModules: ["invoicing"],
    module: "invoicing",
    action: "create",
    amountRials: "5000000",
  });
  assert.equal(ok.allowed, true);

  // Exceeds limit: denied
  const denied = evaluateClientAccess({
    roleKey: "custom",
    customRole,
    entitledModules: ["invoicing"],
    module: "invoicing",
    action: "create",
    amountRials: "20000000",
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, "AMOUNT_LIMIT_EXCEEDED");
  assert.match(denied.reasonFa, /سقف مجاز/);
});
