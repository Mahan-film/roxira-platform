import assert from "node:assert/strict";
import { test } from "node:test";
import { nextAction, rateAsPercent, termProvenance } from "./contracting-ui";
import type { TermUse } from "../types/contracting";

const term = (over: Partial<TermUse>): TermUse => ({ key: "k", label: "l", rate: "0.1", version: 1, source: "s", verified: false, tenantOverride: false, legalFact: false, ...over });

test("an organisation figure is never presented as verified legal fact", () => {
  assert.match(termProvenance(term({ tenantOverride: true, verified: true })), /سازمان/);
  assert.match(termProvenance(term({ verified: true })), /تأییدشده/);
  assert.match(termProvenance(term({ verified: false })), /تأیید نشده/);
});

test("rates become exact percents", () => {
  assert.equal(rateAsPercent("0.1"), "10٪");
  assert.equal(rateAsPercent("0.07"), "7٪");
  assert.equal(rateAsPercent("0.075"), "7.5٪");
  assert.equal(rateAsPercent("0.05"), "5٪");
});

test("statement actions follow the status", () => {
  assert.equal(nextAction("draft"), "approve");
  assert.equal(nextAction("approved"), "post");
  assert.equal(nextAction("posted"), null);
});
