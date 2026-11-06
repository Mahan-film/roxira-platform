import test from "node:test";
import assert from "node:assert/strict";
import { nextDeadlineView } from "./tax-deadline";
import { formatJalaliDate, formatMoneyRial } from "@/lib/fa-format";

test("loading state", () => {
  const out = nextDeadlineView({ loading: true });
  assert.equal(out.state, "loading");
});

test("empty when period null", () => {
  const out = nextDeadlineView({ periodTo: null, loading: false });
  assert.equal(out.state, "empty");
  assert.equal(out.dateLabel, null);
});

test("ready with data", () => {
  const period = "2026-03-20"; // Gregorian ISO
  const payable = "0";
  const out = nextDeadlineView({ periodTo: period, payable, loading: false });
  assert.equal(out.state, "ready");
  assert.equal(out.dateLabel, formatJalaliDate(period));
  assert.equal(out.amountLabel, formatMoneyRial(Number(payable)));
});
