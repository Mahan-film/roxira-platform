import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ENAMAD, enamadHref, enamadLogoSrc } from "./enamad.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("seal urls use the single constant", () => {
  assert.equal(ENAMAD.id, "7480559");
  assert.equal(enamadHref(), `https://trustseal.enamad.ir/?id=7480559&Code=${ENAMAD.code}`);
  assert.equal(enamadLogoSrc(), `https://trustseal.enamad.ir/logo.aspx?id=7480559&Code=${ENAMAD.code}`);
});

test("home page footer renders the roxira seal", () => {
  assert.match(read("../app/page.tsx"), /<EnamadBadge domain="roxira"/);
});

test("badge: plain <a>, target=_blank, referrerpolicy origin on a and img, no rel", () => {
  const src = stripComments(read("../components/layout/EnamadBadge.tsx"));
  assert.match(src, /target="_blank"/);
  assert.equal((src.match(/ENAMAD_REFERRER_ATTRIBUTE\}/g) ?? []).length, 2);
  assert.match(src, /referrerpolicy: "origin"/);
  assert.doesNotMatch(src, /noopener|noreferrer|\brel=/);
  assert.doesNotMatch(src, /next\/link|next\/image/);
});

test("no-referrer is not set by the app or the shared nginx headers", () => {
  const nginx = read("../../../../nginx_config/snippets/security_headers.conf");
  assert.doesNotMatch(nginx, /Referrer-Policy\s+"?no-referrer/);
  assert.match(nginx, /img-src[^;]*https:/);
  assert.doesNotMatch(read("../../next.config.ts"), /no-referrer/);
});
