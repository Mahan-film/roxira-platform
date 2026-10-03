import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "out");
const indexPath = join(outDir, "index.html");

function fail(message) {
  console.error(`Static export check failed: ${message}`);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  fail("out/index.html is missing; run `npm run build` first");
}

const html = readFileSync(indexPath, "utf8");
if (!html.includes('dir="rtl"')) {
  fail('out/index.html does not contain dir="rtl"');
}
if (!html.includes('lang="fa"')) {
  fail('out/index.html does not contain lang="fa"');
}

console.log("Static export check passed: out/index.html is RTL/fa.");
