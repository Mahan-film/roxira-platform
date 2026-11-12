import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateMoadianDeadline,
  sortUnsentInvoicesByUrgency,
  MOADIAN_MAX_DEADLINE_DAYS,
} from "./moadian-send-deadline.ts";

test("returns UNCONFIGURED without labeling invoices as expired when no deadline is set", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-10-01T10:00:00Z";
  const res = calculateMoadianDeadline(issueDate, null, refDate);

  assert.equal(res.elapsedDays, 42);
  assert.equal(res.remainingDays, null);
  assert.equal(res.deadlineDays, null);
  assert.equal(res.urgency, "UNCONFIGURED");
  assert.equal(res.isExpired, false);
  assert.equal(res.isUrgent, false);
  assert.equal(res.statusLabel, "آستانه تنظیم نشده");
});

test("calculates NORMAL status for invoice issued 2 days ago with 7-day threshold", () => {
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

test("calculates EXPIRED status when elapsed days exceed explicit deadline", () => {
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

test("handles custom deadline days and clamps ceiling", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-05T12:00:00Z";
  const res = calculateMoadianDeadline(issueDate, 10, refDate);

  assert.equal(res.elapsedDays, 7);
  assert.equal(res.remainingDays, 3);
  assert.equal(res.urgency, "NORMAL");

  const clamped = calculateMoadianDeadline(issueDate, 999, refDate);
  assert.equal(clamped.deadlineDays, MOADIAN_MAX_DEADLINE_DAYS);
});

test("treats <= 0 or NaN deadlineDays as UNCONFIGURED instead of inventing a threshold", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const issueDate = "2026-11-10T12:00:00Z";
  const zero = calculateMoadianDeadline(issueDate, 0, refDate);
  assert.equal(zero.urgency, "UNCONFIGURED");
  assert.equal(zero.deadlineDays, null);
  assert.equal(zero.remainingDays, null);
});

test("computes deterministic calendar days in Asia/Tehran regardless of host TZ", () => {
  // 2026-11-10T21:30:00Z is 2026-11-11 01:00:00+03:30 in Tehran
  const refDate = new Date("2026-11-12T12:00:00Z"); // 2026-11-12 in Tehran
  const tehranNextDayIssue = "2026-11-10T21:30:00Z";
  const res = calculateMoadianDeadline(tehranNextDayIssue, 7, refDate);
  assert.equal(res.elapsedDays, 1);
  assert.equal(res.remainingDays, 6);
});

test("sortUnsentInvoicesByUrgency puts expired and critical first when configured, or oldest first when unconfigured", () => {
  const refDate = new Date("2026-11-12T12:00:00Z");
  const invoices = [
    { id: "inv-normal", issueDate: "2026-11-11T10:00:00Z" },
    { id: "inv-expired", issueDate: "2026-11-01T10:00:00Z" },
    { id: "inv-warning", issueDate: "2026-11-07T10:00:00Z" },
    { id: "inv-critical", issueDate: "2026-11-05T10:00:00Z" },
  ];

  const sorted = sortUnsentInvoicesByUrgency(invoices, 7, refDate);
  assert.equal(sorted[0].invoice.id, "inv-expired");
  assert.equal(sorted[1].invoice.id, "inv-critical");
  assert.equal(sorted[2].invoice.id, "inv-warning");
  assert.equal(sorted[3].invoice.id, "inv-normal");

  const unconfigured = sortUnsentInvoicesByUrgency(invoices, null, refDate);
  assert.equal(unconfigured[0].invoice.id, "inv-expired");
  assert.equal(unconfigured[0].deadline.isExpired, false);
});
