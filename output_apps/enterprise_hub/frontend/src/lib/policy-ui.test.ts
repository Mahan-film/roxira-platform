import assert from "node:assert/strict";
import { test } from "node:test";

import { groupBadge, isEditable, optionLabel, policyGroupLabel, reasonMinLength } from "./policy-ui.ts";

test("policy group labels are the exact Persian strings", () => {
  assert.equal(policyGroupLabel("A"), "الف: ثابت (غیرقابل تغییر)");
  assert.equal(policyGroupLabel("B"), "ب: حفاظت از دفتر (دلیل طولانی‌تر)");
  assert.equal(policyGroupLabel("C"), "ج: تصمیم مدیریت");
});

test("reason minimum lengths and editability per group", () => {
  assert.equal(reasonMinLength("A"), 0);
  assert.equal(reasonMinLength("B"), 15);
  assert.equal(reasonMinLength("C"), 5);
  assert.equal(isEditable("A"), false);
  assert.equal(isEditable("B"), true);
  assert.equal(isEditable("C"), true);
});

test("option labels are Persian and badges use the Persian group letters", () => {
  assert.equal(groupBadge("A"), "الف");
  assert.equal(groupBadge("B"), "ب");
  assert.equal(groupBadge("C"), "ج");
  assert.equal(optionLabel("allow"), "مجاز باشد");
  assert.equal(optionLabel("unknown_option"), "unknown_option");
});
