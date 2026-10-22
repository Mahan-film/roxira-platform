// Runs INSIDE the sandbox backend container (piped to `node -`, cwd /app) to seed one tenant by importing a
// database package through the real HTTP API (upload -> analysis -> commit), exactly like the UI does.
//   env: T=tenant uuid, U=user uuid, FN=file name, JWT_SECRET (container env); file at /tmp/upload.bin
// Exit 0 only when the package reaches status "committed". Never prints the token.
const T = process.env.T;
const U = process.env.U;
const FN = process.env.FN || "package.sqlite";
const BASE = "http://127.0.0.1:3000/v1/enterprise-hub/data-import";
const fs = require("fs");

const token = require("jsonwebtoken").sign(
  { sub: U, phone: "09000000000", role: "ADMIN", domain: "ROXIRA", tenantId: T, tenantRole: "OWNER" },
  process.env.JWT_SECRET,
  { expiresIn: "2h" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        ...options,
        headers: { Authorization: "Bearer " + token, ...(options.headers || {}) },
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return [res.status, body];
    } catch (err) {
      if (attempt > 5) throw err;
      await sleep(1000);
    }
  }
}

(async () => {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync("/tmp/upload.bin")]), FN);
  let [status, up] = await call("/packages", { method: "POST", body: form });
  console.log("UPLOAD", status, JSON.stringify(up));
  if (status >= 300) process.exit(1);
  const id = up.packageId;

  let detail;
  const t0 = Date.now();
  for (;;) {
    [status, detail] = await call("/packages/" + id);
    if (detail.status !== "analyzing") break;
    if (Date.now() - t0 > 180000) throw new Error("analysis timed out");
    await sleep(1500);
  }
  console.log("ANALYSIS", status, detail.status, ((Date.now() - t0) / 1000).toFixed(1) + "s", detail.error || "");
  if (detail.status === "failed") process.exit(1);

  const body = {
    tables: detail.tables.map((t) => ({
      name: t.name,
      entity: t.detectedEntity || "",
      mapping: t.mapping,
      skip: t.skipped ?? t.detectedEntity === null,
    })),
  };
  let commit;
  [status, commit] = await call("/packages/" + id + "/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("COMMIT", status, JSON.stringify(commit));
  if (status >= 300) process.exit(1);

  const t1 = Date.now();
  for (;;) {
    [status, detail] = await call("/packages/" + id);
    if (["committed", "failed"].includes(detail.status)) break;
    if (Date.now() - t1 > 600000) throw new Error("commit timed out");
    await sleep(2000);
  }
  const [, progress] = await call("/packages/" + id + "/progress");
  console.log("DONE", detail.status);
  console.log("INSERTED", JSON.stringify(progress.inserted));
  console.log("SKIPPED", JSON.stringify(progress.skipped));
  for (const e of (progress.errors || []).slice(0, 20)) console.log("  ERR", e);
  process.exit(detail.status === "committed" ? 0 : 1);
})().catch((err) => {
  console.log("SEED ERROR", err && err.message ? err.message : err);
  process.exit(1);
});
