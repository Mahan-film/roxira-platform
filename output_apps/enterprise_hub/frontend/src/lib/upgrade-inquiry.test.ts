/**
 * Unit tests for the upgrade-inquiry handler (client IP trust and mail gating).
 * Run: npm test   (node:test with native TypeScript stripping; no framework needed)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { handleUpgradeInquiry, resolveClientIp, type InquiryDeps, type Persisted } from "./upgrade-inquiry.ts";

const GOOD = { name: "Ada Lovelace", company: "Analytical Ltd", phone: "+44 20 7946 0000", email: "ada@analytical.example", plan: "pro" };
const headers = (h: Record<string, string> = {}) => new Headers(h);

function deps(persisted: Persisted, mailOk = true) {
  const mails: string[] = [];
  const seenIps: string[] = [];
  const d: InquiryDeps = {
    ownerEmail: "owner@example.test",
    persistLead: async (_lead, ip) => {
      seenIps.push(ip);
      return persisted;
    },
    sendMail: async ({ to }) => {
      mails.push(to);
      return { ok: mailOk, log: "" };
    },
  };
  return { d, mails, seenIps };
}

test("resolveClientIp trusts only a valid X-Real-IP", () => {
  assert.equal(resolveClientIp(headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(resolveClientIp(headers({ "x-real-ip": "not-an-ip" })), "");
  // Spoofable headers are ignored.
  assert.equal(resolveClientIp(headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8, 9.9.9.9" })), "");
  assert.equal(
    resolveClientIp(headers({ "x-real-ip": "203.0.113.9", "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" })),
    "203.0.113.9",
  );
});

test("forged CF-Connecting-IP / X-Forwarded-For never reach the backend rate limit", async () => {
  const { d, seenIps } = deps({ ok: true, id: 1 });
  await handleUpgradeInquiry(GOOD, headers({ "x-real-ip": "203.0.113.9", "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7" }), d);
  await handleUpgradeInquiry(GOOD, headers({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7" }), d);
  assert.deepEqual(seenIps, ["203.0.113.9", ""]);
});

test("stored lead: owner mail and customer acknowledgement are sent", async () => {
  const { d, mails } = deps({ ok: true, id: 35 });
  const res = await handleUpgradeInquiry(GOOD, headers(), d);
  assert.equal(res.status, 200);
  assert.deepEqual(mails.sort(), ["ada@analytical.example", "owner@example.test"]);
});

test("stored lead survives mail failure", async () => {
  const { d } = deps({ ok: true, id: 2 }, false);
  const res = await handleUpgradeInquiry(GOOD, headers(), d);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).stored, true);
});

test("429 from the backend sends no mail", async () => {
  const { d, mails } = deps({ ok: false, status: 429 });
  const res = await handleUpgradeInquiry(GOOD, headers(), d);
  assert.equal(res.status, 429);
  assert.deepEqual(mails, []);
});

for (const status of [400, 422, 401, 403, 404]) {
  test(`backend ${status} sends no mail to anyone`, async () => {
    const { d, mails } = deps({ ok: false, status });
    const res = await handleUpgradeInquiry(GOOD, headers(), d);
    assert.equal(res.status, status === 400 || status === 422 ? 400 : 502);
    assert.deepEqual(mails, []);
  });
}

for (const status of [0, 500, 503]) {
  test(`backend outage (${status}) mails only the owner, never the caller address`, async () => {
    const { d, mails } = deps({ ok: false, status });
    const res = await handleUpgradeInquiry(GOOD, headers(), d);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stored, false);
    assert.deepEqual(mails, ["owner@example.test"]);
  });
}

test("backend outage and owner mail failure returns 502", async () => {
  const { d, mails } = deps({ ok: false, status: 0 }, false);
  const res = await handleUpgradeInquiry(GOOD, headers(), d);
  assert.equal(res.status, 502);
  assert.deepEqual(mails, ["owner@example.test"]);
});

test("email longer than 150 chars is rejected before any backend call or mail", async () => {
  const { d, mails, seenIps } = deps({ ok: true, id: 1 });
  const long = `${"a".repeat(140)}@example.com`;
  assert.ok(long.length > 150);
  const res = await handleUpgradeInquiry({ ...GOOD, email: long }, headers(), d);
  assert.equal(res.status, 400);
  assert.deepEqual(mails, []);
  assert.deepEqual(seenIps, []);
});

test("email of exactly 150 chars is accepted", async () => {
  const { d } = deps({ ok: true, id: 1 });
  const email = `${"a".repeat(150 - "@example.com".length)}@example.com`;
  assert.equal(email.length, 150);
  assert.equal((await handleUpgradeInquiry({ ...GOOD, email }, headers(), d)).status, 200);
});

test("invalid input is rejected with 400 and no side effects", async () => {
  const { d, mails, seenIps } = deps({ ok: true, id: 1 });
  for (const bad of [{ ...GOOD, email: "nope" }, { ...GOOD, name: "x" }, { ...GOOD, phone: "abc" }, null, "str"]) {
    assert.equal((await handleUpgradeInquiry(bad, headers(), d)).status, 400);
  }
  assert.deepEqual(mails, []);
  assert.deepEqual(seenIps, []);
});

test("nginx overwrites X-Forwarded-For instead of appending a client-supplied value", async () => {
  const { readFileSync } = await import("node:fs");
  for (const rel of ["../../../../nginx_config/nginx.conf", "../../../../nginx_config/snippets/proxy_headers.conf"]) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!text.includes("$proxy_add_x_forwarded_for"), `${rel} must not append to client X-Forwarded-For`);
  }
});

test("stored lead with failed owner mail succeeds but says mail was not sent", async () => {
  const { d } = deps({ ok: true, id: 3 }, false);
  const body = await (await handleUpgradeInquiry(GOOD, headers(), d)).json();
  assert.equal(body.success, true);
  assert.equal(body.stored, true);
  assert.equal(body.ownerNotified, false);
  assert.match(body.message, /could not be sent/);
});

test("no owner mailbox configured: outage is a 502, stored lead still succeeds", async () => {
  const outage = deps({ ok: false, status: 0 });
  outage.d.ownerEmail = "";
  assert.equal((await handleUpgradeInquiry(GOOD, headers(), outage.d)).status, 502);
  assert.deepEqual(outage.mails, []);
  const stored = deps({ ok: true, id: 4 });
  stored.d.ownerEmail = "";
  const res = await handleUpgradeInquiry(GOOD, headers(), stored.d);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ownerNotified, false);
});
