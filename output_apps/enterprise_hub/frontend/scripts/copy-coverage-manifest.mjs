// Copies data/legal/coverage_manifest.json into public/ when the source exists.
// Exits 0 and keeps the committed copy when the source is missing (e.g. Docker context).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../../../data/legal/coverage_manifest.json");
const dest = resolve(here, "../public/coverage_manifest.json");

if (existsSync(src)) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("coverage manifest copied");
} else {
  console.log("coverage manifest source missing; keeping committed copy");
}
