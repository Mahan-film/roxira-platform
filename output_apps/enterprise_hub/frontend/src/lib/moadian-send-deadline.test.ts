import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateMoadianDeadline,
  sortUnsentInvoicesByUrgency,
  MOADIAN_DEFAULT_DEADLINE_DAYS,
} from "./moadian-send-deadline.ts";

test("calculates NORMAL status for invoice issued 2 days ago with 7-day default", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-10T10:00:00Z";
  const res = calculateMoadianDeadline(issueDate, 7, refDate);

  assert.equal(res.elapsedDays, 2);
  assert.equal(res.remainingDays, 5);
  assert.equal(res.urgency, "NORMAL");
  assert.equal(res.isExpired, false);
  assert.equal(res.isUrgent, false);
  assert.equal(res.badgeVariant, "secondary");
});

test("calculates WARNING status for invoice issued 5 days ago (2 days remaining)", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-07T10:00:00Z";
  const res = calculateMoadianDeadline(issueDate, 7, refDate);

  assert.equal(res.elapsedDays, 5);
  assert.equal(res.remainingDays, 2);
  assert.equal(res.urgency, "WARNING");
  assert.equal(res.isUrgent, true);
  assert.equal(res.isExpired, false);
  assert.equal(res.badgeVariant, "outline");
});

test("calculates CRITICAL status on last day (remaining = 0)", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-05T10:00:00Z";
  const res = calculateMoadianDeadline(issueDate, 7, refDate);

  assert.equal(res.elapsedDays, 7);
  assert.equal(res.remainingDays, 0);
  assert.equal(res.urgency, "CRITICAL");
  assert.equal(res.isUrgent, true);
  assert.equal(res.isExpired, false);
  assert.equal(res.statusLabel, "روز آخر مهلت");
  assert.equal(res.badgeVariant, "destructive");
});

test("calculates EXPIRED status when elapsed days exceed deadline", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-01T10:00:00Z";
  const res = calculateMoadianDeadline(issueDate, 7, refDate);

  assert.equal(res.elapsedDays, 11);
  assert.equal(res.remainingDays, -4);
  assert.equal(res.urgency, "EXPIRED");
  assert.equal(res.isUrgent, true);
  assert.equal(res.isExpired, true);
  assert.equal(res.statusLabel, "منقضی شده");
  assert.equal(res.badgeVariant, "destructive");
});

test("handles custom deadline days (e.g. 10 days)", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-05T12:00:00Z"; // 7 days ago
  const res = calculateMoadianDeadline(issueDate, 10, refDate);

  assert.equal(res.elapsedDays, 7);
  assert.equal(res.remainingDays, 3);
  assert.equal(res.urgency, "NORMAL");
  assert.equal(res.isUrgent, false);
});

test("defaults to MOADIAN_DEFAULT_DEADLINE_DAYS if deadlineDays is <= 0 or invalid", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-10T12:00:00Z";
  const res = calculateMoadianDeadline(issueDate, 0, refDate);

  assert.equal(MOADIAN_DEFAULT_DEADLINE_DAYS, 7);
  assert.equal(res.remainingDays, 5);
});

test("sortUnsentInvoicesByUrgency puts expired and critical first", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const invoices = [
    { id: "inv-normal", issueDate: "2026-11-11T10:00:00Z" }, // 1 day ago (6 remaining)
    { id: "inv-expired", issueDate: "2026-11-01T10:00:00Z" }, // 11 days ago (-4 remaining)
    { id: "inv-warning", issueDate: "2026-11-07T10:00:00Z" }, // 5 days ago (2 remaining)
    { id: "inv-critical", issueDate: "2026-11-05T10:00:00Z" }, // 7 days ago (0 remaining)
  ];

  const sorted = sortUnsentInvoicesByUrgency(invoices, 7, refDate);

  assert.equal(sorted[0].invoice.id, "inv-expired");
  assert.equal(sorted[1].invoice.id, "inv-critical");
  assert.equal(sorted[2].invoice.id, "inv-warning");
  assert.equal(sorted[3].invoice.id, "inv-normal");
});
