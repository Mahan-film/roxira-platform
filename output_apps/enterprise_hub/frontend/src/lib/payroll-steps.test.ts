import assert from "node:assert/strict";
import { test } from "node:test";
import { payrollSteps } from "./payroll-steps.ts";

test("payrollSteps returns correct current step and states", () => {
  // null -> current 0 (month)
  const v0 = payrollSteps(null, false);
  assert.equal(v0.current, 0);
  assert.equal(v0.steps[0].state, "current");
  assert.equal(v0.steps[1].state, "todo");

  // DRAFT + false -> current 1 (review)
  const v1 = payrollSteps({ status: "DRAFT" }, false);
  assert.equal(v1.current, 1);
  assert.equal(v1.steps[0].state, "done");
  assert.equal(v1.steps[1].state, "current");
  assert.equal(v1.steps[2].state, "todo");

  // DRAFT + true -> current 2 (payslips)
  const v2 = payrollSteps({ status: "DRAFT" }, true);
  assert.equal(v2.current, 2);
  assert.equal(v2.steps[0].state, "done");
  assert.equal(v2.steps[1].state, "done");
  assert.equal(v2.steps[2].state, "current");
  assert.equal(v2.steps[3].state, "todo");

  // POSTED -> current 3 (posting) and steps 0 to 2 are done, step 3 is current
  const v3 = payrollSteps({ status: "POSTED" }, true);
  assert.equal(v3.current, 3);
  assert.deepEqual(
    v3.steps.map((s) => s.state),
    ["done", "done", "done", "current"],
  );
});
