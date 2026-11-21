import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CHUNKED_FROM_BYTES,
  CHUNKED_MAX_BYTES,
  FALLBACK_ACCEPT,
  acceptFromFormats,
  chunkResumeKey,
  clearResumeJobId,
  getSavedResumeJobId,
  routeImportFile,
  saveResumeJobId,
} from "./import-routing.ts";

const MB = 1024 * 1024;

test("accept list comes from the readable rows of the support matrix, each extension once", () => {
  const accept = acceptFromFormats([
    { extensions: [".csv", ".tsv"], status: "supported" },
    { extensions: [".sql"], status: "partial" },
    { extensions: [".sql", ".CSV"], status: "supported" },
    { extensions: ["sqlite", ".db"], status: "supported" },
    { extensions: [".xlsx"], status: "heuristic" },
    { extensions: [".mdb"], status: "guide" },
    { extensions: [".sta"], status: "unsupported" },
  ]);
  assert.equal(accept, ".csv,.db,.sql,.sqlite,.tsv,.xlsx");
});

test("an empty or unreadable matrix falls back to the static list", () => {
  assert.equal(acceptFromFormats([]), FALLBACK_ACCEPT);
  assert.ok(FALLBACK_ACCEPT.includes(".sql") && FALLBACK_ACCEPT.includes(".sqlite"));
});

test("small spreadsheets go through the one-request preview", () => {
  assert.equal(routeImportFile({ name: "a.CSV", size: 1 * MB }, true), "single");
  assert.equal(routeImportFile({ name: "scan.png", size: CHUNKED_FROM_BYTES }, true), "single");
});

test("with bulk import, dumps and archives of any size and every file over 5 MB go to bulk (#325)", () => {
  for (const name of ["dump.sql", "books.sqlite", "x.db", "a.zip"]) {
    assert.equal(routeImportFile({ name, size: 1000 }, true), "bulk", name);
  }
  assert.equal(routeImportFile({ name: "big.csv", size: CHUNKED_FROM_BYTES + 1 }, true), "bulk");
  assert.equal(routeImportFile({ name: "huge.csv", size: 60 * MB }, true), "bulk");
  // Other formats the one-request preview cannot read stay on the whole-database tab.
  for (const name of ["old.dbf", "a.xls", "a.ods", "a.json"]) {
    assert.equal(routeImportFile({ name, size: 1000 }, true), "package", name);
  }
});

test("without bulk import, the chunked whole-database tab takes files up to its own limit", () => {
  for (const name of ["dump.sql", "books.sqlite", "a.zip"]) {
    assert.equal(routeImportFile({ name, size: 1000 }, false), "package", name);
  }
  assert.equal(routeImportFile({ name: "big.csv", size: 17 * MB }, false), "package");
  assert.equal(routeImportFile({ name: "huge.csv", size: 60 * MB }, false), "package");
  assert.equal(routeImportFile({ name: "huge.csv", size: CHUNKED_MAX_BYTES + 1 }, false), "bulk");
});

test("the resume key identifies the same file, not just the same name", () => {
  const a = chunkResumeKey({ name: "a.csv", size: 10, lastModified: 1 });
  assert.equal(a, chunkResumeKey({ name: "a.csv", size: 10, lastModified: 1 }));
  assert.notEqual(a, chunkResumeKey({ name: "a.csv", size: 11, lastModified: 1 }));
});

test("picking the same file again after a reload resumes the bulk job via saved job id (#439)", () => {
  const file = { name: "database-dump.sql", size: 50 * MB, lastModified: 1732200000000 };
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    length: store.size,
  };

  // Initially, before any upload starts:
  assert.equal(getSavedResumeJobId(file, mockStorage), undefined);

  // When bulk upload starts, the job id is saved under chunkResumeKey:
  saveResumeJobId(file, "bulk-job-9876", mockStorage);
  assert.equal(store.get(chunkResumeKey(file)), "bulk-job-9876");

  // Re-picking the same file after reload retrieves the active job id to resume:
  const resumedJobId = getSavedResumeJobId(file, mockStorage);
  assert.equal(resumedJobId, "bulk-job-9876");

  // A different file or modified file does not resume the old job:
  const modifiedFile = { name: "database-dump.sql", size: 50 * MB, lastModified: 1732299999999 };
  assert.equal(getSavedResumeJobId(modifiedFile, mockStorage), undefined);

  // Once upload finishes, the resume entry is cleared:
  clearResumeJobId(file, mockStorage);
  assert.equal(getSavedResumeJobId(file, mockStorage), undefined);
});
