// Run: npx tsx --test src/middleware.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { middleware } from "./middleware.ts";

const call = (host: string, path: string) =>
  middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
const location = (res: Response) => res.headers.get("location");

test("roxira.net: /app and /app/* go to the English account panel, not to /", () => {
  assert.equal(location(call("roxira.net", "/app")), "https://roxira.net/en/app");
  assert.equal(location(call("www.roxira.net", "/app/crm")), "https://www.roxira.net/en/app");
});

test("roxira.net: /en/app is served (not redirected), and / still rewrites to /en", () => {
  const panel = call("roxira.net", "/en/app");
  assert.equal(location(panel), null);
  assert.equal(panel.headers.get("x-middleware-next"), "1");
  assert.equal(call("roxira.net", "/").headers.get("x-middleware-rewrite")?.endsWith("/en"), true);
});

test("roxira.net: other Iran-only suites still go to /, /admin stays a plain pass-through", () => {
  for (const path of ["/invoicing", "/accounting", "/hr", "/crm"]) {
    assert.equal(location(call("roxira.net", path)), "https://roxira.net/", path);
  }
  assert.equal(location(call("roxira.net", "/admin")), null);
});

test("roxira.ir keeps serving /app; the Smart Judge domain sends /app to roxira.ir", () => {
  assert.equal(location(call("roxira.ir", "/app")), null);
  assert.equal(location(call("ghazihoushmand.ir", "/app")), "https://roxira.ir/app");
});
