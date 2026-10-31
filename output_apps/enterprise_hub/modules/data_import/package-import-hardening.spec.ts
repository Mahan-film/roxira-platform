import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { deflateRawSync } from "zlib";
import { strToU8, zipSync } from "fflate";
import { BadRequestException } from "@nestjs/common";
import {
  assertAllowedStatement,
  detectForeignDialect,
  openSqlDump,
  SqlDumpParseError,
} from "./parsers/sql-dump.parser";
import {
  runStatementsInWorker,
  SqlWorkerError,
} from "./parsers/sql-dump-worker";
import { loadSqlJs } from "./parsers/sqljs-common";
import { parseXlsx, XlsxParseError } from "./parsers/xlsx.parser";
import {
  parseZipPackage,
  tableNameFromPath,
  ZipPackageError,
} from "./parsers/zip.parser";
import { CrmLeadsRegistry } from "./registry/crm-leads.registry";
import { EntityRegistryService } from "./registry/entity-registry.service";
import { EntityKeyPipe } from "./dto/entity-key.pipe";
import { EntityImportService } from "./services/entity-import.service";
import { PackageAnalysisService } from "./services/package-analysis.service";
import { PackageCommitService } from "./services/package-commit.service";
import { PackageImportService } from "./services/package-import.service";
import { PackageProgressService } from "./services/package-progress.service";
import {
  detectPackageKind,
  PackageStoreService,
} from "./services/package-store.service";

jest.mock("./constants/package-import.constants", () => ({
  ...jest.requireActual("./constants/package-import.constants"),
  PACKAGE_MAX_UNCOMPRESSED_BYTES: 2 * 1024 * 1024,
}));

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(__dirname, "__fixtures__", name));
}

/** Sets a ZIP's central-directory "uncompressed size" fields to a lie (header forging). */
function forgeDeclaredSizes(zip: Buffer, size: number): Buffer {
  const copy = Buffer.from(zip);
  for (let pos = 0; pos + 46 < copy.length; pos += 1) {
    if (copy.readUInt32LE(pos) === 0x02014b50) {
      copy.writeUInt32LE(size, pos + 24);
    }
  }
  return copy;
}

function sheetZip(rowsXml: string, filler = 0): Buffer {
  const sheet =
    `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${rowsXml}</sheetData></worksheet>` +
    " ".repeat(filler);
  return Buffer.from(zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) }));
}

describe("hardening 1 — decompression limits", () => {
  const original = process.env.IMPORT_MAX_INFLATED_BYTES;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.IMPORT_MAX_INFLATED_BYTES;
    } else {
      process.env.IMPORT_MAX_INFLATED_BYTES = original;
    }
  });

  it("aborts an XLSX whose sheet inflates past the cap, even with a forged header size", () => {
    process.env.IMPORT_MAX_INFLATED_BYTES = String(1024 * 1024);
    // 8 MB of spaces deflates to a few KB; the header is forged to claim 10 bytes.
    const bomb = forgeDeclaredSizes(
      sheetZip('<row r="1"/>', 8 * 1024 * 1024),
      10,
    );
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(() => parseXlsx(bomb)).toThrow(XlsxParseError);
    expect(() => parseXlsx(bomb)).toThrow(/بیش از سقف/);
  });

  it("still parses a normal XLSX under the cap", () => {
    const ok = sheetZip(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>b</t></is></c></row>',
    );
    expect(parseXlsx(ok).headers).toEqual(["a"]);
  });

  it("caps a ZIP package by REAL inflated bytes, not by header sizes", () => {
    const zip = Buffer.from(
      zipSync({ "big.csv": new Uint8Array(6 * 1024 * 1024).fill(0x61) }),
    );
    const forged = forgeDeclaredSizes(zip, 100);
    expect(() => parseZipPackage(forged)).toThrow(ZipPackageError);
    expect(() => parseZipPackage(forged)).toThrow(/سقف مجاز/);
  });

  it("shares one budget across XLSX files nested in a ZIP", () => {
    const inner = sheetZip(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>h</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>v</t></is></c></row>',
      1_200_000,
    );
    const zip = Buffer.from(
      zipSync({ "a.xlsx": inner, "b.xlsx": inner }, { level: 0 }),
    );
    expect(() => parseZipPackage(zip)).toThrow(/سقف مجاز|بیش از/);
  });
});

describe("hardening 2 — SQL dump", () => {
  it.each([
    "CREATE TABLE x AS WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c) SELECT * FROM c",
    'CREATE TABLE IF NOT EXISTS "x y" AS SELECT 1',
    "CREATE TABLE x (a) /* sneaky */ AS SELECT 1",
    "INSERT INTO t SELECT * FROM u",
    "INSERT INTO t WITH RECURSIVE c(n) AS (SELECT 1) SELECT n FROM c",
    "INSERT INTO t VALUES (zeroblob(1000000000))",
    "INSERT INTO t VALUES ((SELECT 1))",
  ])("rejects %s", (statement) => {
    expect(() => assertAllowedStatement(statement)).toThrow(SqlDumpParseError);
  });

  it.each([
    'CREATE TABLE t (a INTEGER, "select" TEXT)',
    "INSERT INTO t (a, b) VALUES (1, 'x; SELECT 2 FROM (y)'), (2, NULL)",
    "INSERT INTO \"t\" VALUES (X'00ff', -1.5e3)",
  ])("accepts %s", (statement) => {
    expect(() => assertAllowedStatement(statement)).not.toThrow();
  });

  it("kills a runaway statement in the worker at the timeout", async () => {
    process.env.IMPORT_SQL_TIMEOUT_MS = "600";
    const slow =
      "WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c) SELECT count(*) FROM c";
    const started = Date.now();
    await expect(runStatementsInWorker([slow])).rejects.toMatchObject({
      reason: "timeout",
    });
    expect(Date.now() - started).toBeLessThan(5000);
    delete process.env.IMPORT_SQL_TIMEOUT_MS;
  }, 15000);

  it("openSqlDump refuses the recursive CTAS before any worker starts", async () => {
    await expect(
      openSqlDump(
        "CREATE TABLE x AS WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c) SELECT * FROM c;",
      ),
    ).rejects.toBeInstanceOf(SqlDumpParseError);
  });

  it("runs a legitimate dump through the worker", async () => {
    const parsed = await openSqlDump(
      "CREATE TABLE t (a TEXT, b TEXT); INSERT INTO t VALUES ('x','y'),('z','w');",
    );
    expect(parsed.tables[0].rowCount).toBe(2);
    parsed.close();
  });

  it("SqlWorkerError is exported for callers", () => {
    expect(new SqlWorkerError("oom").reason).toBe("oom");
  });
});

describe("hardening 6 — foreign dumps get a clear Persian error", () => {
  const mysql =
    "-- MySQL dump 10.13\nCREATE TABLE `a` (id int) ENGINE=InnoDB;\nINSERT INTO `a` VALUES (1);";
  const pg =
    "-- PostgreSQL database dump\nSET statement_timeout = 0;\nCOPY public.a (id) FROM stdin;\n1\n\\.\n";
  const mssql =
    "SET ANSI_NULLS ON\nGO\nCREATE TABLE [dbo].[a]([id] [int] NOT NULL)\nGO\n";

  it.each([
    ["mysql", mysql, /MySQL/],
    ["postgres", pg, /PostgreSQL/],
    ["mssql", mssql, /SQL Server/],
  ])("%s dump", async (dialect, text, label) => {
    expect(detectForeignDialect(text)).toBe(dialect);
    const promise = openSqlDump(text);
    await expect(promise).rejects.toBeInstanceOf(SqlDumpParseError);
    await expect(promise).rejects.toThrow(label);
    await expect(promise).rejects.toThrow(/اکسل|CSV/);
  });

  it("does not misclassify a SQLite dump", () => {
    expect(
      detectForeignDialect(
        "CREATE TABLE t (a TEXT);\nINSERT INTO t VALUES ('x');",
      ),
    ).toBeNull();
  });

  it.each(["backup.bak", "db.mdf", "x.ldf"])(
    "rejects %s by extension",
    (name) => {
      expect(() => detectPackageKind(name, Buffer.from("whatever"))).toThrow(
        BadRequestException,
      );
    },
  );

  it("rejects SQL Server (TAPE) and pg_dump (PGDMP) magic bytes", () => {
    expect(() => detectPackageKind("a.sql", Buffer.from("TAPE\0\0\0"))).toThrow(
      /SQL Server/,
    );
    expect(() => detectPackageKind("a.sql", Buffer.from("PGDMP\0"))).toThrow(
      /PostgreSQL/,
    );
  });
});

describe("hardening 5 — names and entity keys", () => {
  it("sanitises table names derived from ZIP paths", () => {
    expect(tableNameFromPath("dir/../../etc/pass wd.csv")).toBe("pass wd");
    expect(tableNameFromPath('a"; DROP TABLE x;--.csv')).toBe(
      "a__ DROP TABLE x_--",
    );
    expect(tableNameFromPath("__proto__.csv")).toBe("table");
    expect(
      tableNameFromPath("x".repeat(300) + ".csv").length,
    ).toBeLessThanOrEqual(64);
    expect(tableNameFromPath("مشتریان.xlsx")).toBe("مشتریان");
  });

  it("keeps same-named files from different folders as distinct tables", () => {
    const zip = Buffer.from(
      zipSync({
        "a/items.csv": strToU8("sku,name\n1,x"),
        "b/items.csv": strToU8("sku,name\n2,y"),
      }),
    );
    const names = parseZipPackage(zip).tables.map((t) => t.name);
    expect(new Set(names).size).toBe(2);
  });

  it("EntityKeyPipe allowlists the key shape", () => {
    const pipe = new EntityKeyPipe();
    expect(pipe.transform("hr-employees")).toBe("hr-employees");
    expect(() => pipe.transform("../etc")).toThrow(BadRequestException);
    expect(() => pipe.transform("A;DROP")).toThrow(BadRequestException);
  });
});

describe("hardening 3 — expired upload sweeper", () => {
  it("deletes expired package dirs and keeps fresh ones", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rx-sweep-"));
    process.env.IMPORT_TMP_DIR = root;
    const store = new PackageStoreService();
    const old = await store.createPackage(
      "tenant-a",
      {
        originalname: "a.zip",
        buffer: Buffer.from(zipSync({ "a.csv": strToU8("a\n1") })),
      },
      1_000_000,
    );
    const fresh = await store.createPackage(
      "tenant-a",
      {
        originalname: "b.zip",
        buffer: Buffer.from(zipSync({ "b.csv": strToU8("a\n1") })),
      },
      1_000_000,
    );
    old.status = "ready";
    old.createdAt = Date.now() - 3 * 60 * 60 * 1000;
    await store.writeState(old);
    fresh.status = "ready";
    await store.writeState(fresh);

    expect(await store.sweepExpired()).toBe(1);
    const left = fs.readdirSync(path.join(root, "tenant-a"));
    expect(left).toEqual([fresh.packageId]);
    delete process.env.IMPORT_TMP_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/* ------------------------------ end-to-end flow ------------------------------ */

function buildHarness() {
  const leads: Array<{
    id: number;
    tenantId: string;
    email: string;
    phone: string | null;
  }> = [];
  let nextId = 1;
  const crmRepository = {
    createLeads: async (
      tenantId: string,
      list: Array<{ email: string; phone: string | null }>,
    ) =>
      list.map((data) => {
        const row = { ...data, id: nextId++, tenantId };
        leads.push(row);
        return row;
      }),
    createLead: async (
      tenantId: string,
      data: { email: string; phone: string | null },
    ) => {
      const row = { ...data, id: nextId++, tenantId };
      leads.push(row);
      return row;
    },
    findLeadEmails: async (tenantId: string, emails: string[]) =>
      leads
        .filter((l) => l.tenantId === tenantId && emails.includes(l.email))
        .map((l) => l.email),
    findLeadPhones: async (tenantId: string, phones: string[]) =>
      leads
        .filter(
          (l) => l.tenantId === tenantId && l.phone && phones.includes(l.phone),
        )
        .map((l) => l.phone as string),
    deleteLeadsByIds: async (tenantId: string, ids: number[]) => {
      let removed = 0;
      for (let i = leads.length - 1; i >= 0; i -= 1) {
        if (leads[i].tenantId === tenantId && ids.includes(leads[i].id)) {
          leads.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },
  };

  const batches = new Map<
    string,
    { id: string; tenantId: string; inserted: number; undone: boolean }
  >();
  const items: Array<{
    tenantId: string;
    batchId: string;
    entity: string;
    ownerId: string;
  }> = [];
  const batchRepo = {
    createBatch: async (
      tenantId: string,
      d: { id: string; inserted: number },
    ) => {
      batches.set(d.id, {
        id: d.id,
        tenantId,
        inserted: d.inserted,
        undone: false,
      });
    },
    setInserted: async (_t: string, id: string, n: number) => {
      const b = batches.get(id);
      if (b) b.inserted = n;
    },
    removeBatch: async (_t: string, id: string) => void batches.delete(id),
    addItems: async (
      tenantId: string,
      batchId: string,
      entity: string,
      rows: Array<{ ownerId: number | string }>,
    ) => {
      for (const r of rows)
        items.push({ tenantId, batchId, entity, ownerId: String(r.ownerId) });
    },
    findBatch: async (tenantId: string, id: string) => {
      const b = batches.get(id);
      return b && b.tenantId === tenantId ? b : null;
    },
    findItems: async (tenantId: string, batchId: string) =>
      items.filter((i) => i.tenantId === tenantId && i.batchId === batchId),
    markUndone: async (_t: string, id: string) => {
      const b = batches.get(id);
      if (b) b.undone = true;
    },
    removeItems: async (_t: string, batchId: string) => {
      for (let i = items.length - 1; i >= 0; i -= 1)
        if (items[i].batchId === batchId) items.splice(i, 1);
    },
  };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rx-e2e-"));
  process.env.IMPORT_TMP_DIR = root;
  const store = new PackageStoreService();
  const registry = new EntityRegistryService([
    new CrmLeadsRegistry(crmRepository as never),
  ] as never);
  const analysis = new PackageAnalysisService(store, registry);
  const progress = new PackageProgressService();
  const commit = new PackageCommitService(
    store,
    analysis,
    registry,
    progress,
    batchRepo as never,
  );
  const quota = {
    assertWithinQuota: async () => undefined,
    recordImport: async () => undefined,
  };
  const service = new PackageImportService(
    store,
    analysis,
    commit,
    quota as never,
    progress,
  );
  const undo = new EntityImportService(
    registry,
    {} as never,
    {} as never,
    batchRepo as never,
    {} as never,
  );
  return {
    leads,
    batches,
    items,
    batchRepo,
    service,
    undo,
    crmRepository,
    store,
    registry,
    analysis,
    progress,
    commit,
    root,
  };
}

async function sqliteLeadsFile(): Promise<Buffer> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE leads (full_name TEXT, email TEXT, phone TEXT)");
  db.run(
    "INSERT INTO leads VALUES ('Sara A','sara@example.com','09120000001'),('Reza B','reza@example.com','09120000002')",
  );
  const bytes = db.export();
  db.close();
  return Buffer.from(bytes);
}

const LEADS_CSV =
  "full name,email,phone\nSara A,sara@example.com,09120000001\nReza B,reza@example.com,09120000002\n";

describe("end-to-end: upload → preview → commit → undo per format", () => {
  const formats: Array<[string, string, () => Promise<Buffer>, string]> = [
    ["sqlite", "data.sqlite", sqliteLeadsFile, "leads"],
    [
      "sql dump",
      "data.sql",
      async () =>
        Buffer.from(
          "CREATE TABLE leads (full_name TEXT, email TEXT, phone TEXT);" +
            "INSERT INTO leads VALUES ('Sara A','sara@example.com','09120000001'),('Reza B','reza@example.com','09120000002');",
        ),
      "leads",
    ],
    [
      "zip of csv",
      "data.zip",
      async () => Buffer.from(zipSync({ "leads.csv": strToU8(LEADS_CSV) })),
      "leads",
    ],
    [
      "zip of xlsx",
      "data.zip",
      async () => {
        const cell = (ref: string, text: string): string =>
          `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
        const xlsx = sheetZip(
          `<row r="1">${cell("A1", "full name")}${cell("B1", "email")}${cell("C1", "phone")}</row>` +
            `<row r="2">${cell("A2", "Sara A")}${cell("B2", "sara@example.com")}${cell("C2", "09120000001")}</row>` +
            `<row r="3">${cell("A3", "Reza B")}${cell("B3", "reza@example.com")}${cell("C3", "09120000002")}</row>`,
        );
        return Buffer.from(zipSync({ "leads.xlsx": new Uint8Array(xlsx) }));
      },
      "leads",
    ],
  ];

  it.each(formats)(
    "%s",
    async (_label, fileName, build, tableName) => {
      const h = buildHarness();
      const tenant = "tenant-e2e";
      const created = await h.service.createPackage(tenant, {
        originalname: fileName,
        buffer: await build(),
      });
      const status = await h.service.getPackage(tenant, created.packageId);
      expect(status.status).toBe("ready");
      expect(status.tables.map((t) => t.name)).toContain(tableName);

      const { batchId } = await h.service.commitPackage(
        tenant,
        created.packageId,
        {
          tables: [
            {
              name: tableName,
              entity: "crm-leads",
              mapping: {
                [fileName.endsWith(".zip") ? "full name" : "full_name"]:
                  "fullName",
                email: "email",
                phone: "phone",
              },
            },
          ],
        },
      );
      const prog = await h.service.getProgress(tenant, created.packageId);
      expect(prog.errors).toEqual([]);
      expect(h.leads).toHaveLength(2);
      expect(h.batches.get(batchId)?.inserted).toBe(2);
      expect(h.items.filter((i) => i.batchId === batchId)).toHaveLength(2);
      const progress = await h.service.getProgress(tenant, created.packageId);
      expect(progress.phase).toBe("committed");

      const undone = await h.undo.undoBatch(tenant, batchId);
      expect(undone.removed).toBe(2);
      expect(h.leads).toHaveLength(0);
      fs.rmSync(h.root, { recursive: true, force: true });
      delete process.env.IMPORT_TMP_DIR;
    },
    30000,
  );

  it("a MySQL dump with no data rows fails with Persian guidance (dumps are now parsed, not rejected)", async () => {
    const h = buildHarness();
    const created = await h.service.createPackage("t", {
      originalname: "dump.sql",
      buffer: Buffer.from(
        "-- MySQL dump 10.13\nCREATE TABLE `a` (id int) ENGINE=InnoDB;",
      ),
    });
    const status = await h.service.getPackage("t", created.packageId);
    expect(status.status).toBe("failed");
    expect(status.error).toMatch(/INSERT/);
    fs.rmSync(h.root, { recursive: true, force: true });
    delete process.env.IMPORT_TMP_DIR;
  });

  it("creates the batch BEFORE rows so a mid-commit crash is still undoable", async () => {
    const h = buildHarness();
    const tenant = "tenant-crash";
    const created = await h.service.createPackage(tenant, {
      originalname: "data.zip",
      buffer: Buffer.from(
        zipSync({
          "one.csv": strToU8(LEADS_CSV),
          "two.csv": strToU8(
            "full name,email,phone\nNew C,c@example.com,09120000003\n",
          ),
        }),
      ),
    });
    // Second adapter call explodes after the first one wrote rows.
    const realCreate = h.crmRepository.createLeads;
    let calls = 0;
    h.crmRepository.createLeads = async (t: string, list: never[]) => {
      calls += 1;
      if (calls === 2) throw new Error("db down");
      return realCreate(t, list);
    };
    h.crmRepository.createLead = async () => {
      throw new Error("db down");
    };
    const mapping = { "full name": "fullName", email: "email", phone: "phone" };
    await h.service.commitPackage(tenant, created.packageId, {
      tables: [
        { name: "one", entity: "crm-leads", mapping },
        { name: "two", entity: "crm-leads", mapping },
      ],
    });
    // Per-row fallback failed too, so adapter reports failures (no throw): batch still intact.
    expect(h.leads).toHaveLength(2);
    const batchId = [...h.batches.keys()][0];
    expect(h.items.filter((i) => i.batchId === batchId)).toHaveLength(2);
    expect((await h.undo.undoBatch(tenant, batchId)).removed).toBe(2);

    // Hard crash inside the loop: batch + items recorded so far survive and the state is 'failed'.
    const h2 = buildHarness();
    const c2 = await h2.service.createPackage("t2", {
      originalname: "data.zip",
      buffer: Buffer.from(zipSync({ "one.csv": strToU8(LEADS_CSV) })),
    });
    const st = await h2.store.getState("t2", c2.packageId);
    const spy = jest
      .spyOn(h2.progress, "set")
      .mockImplementationOnce(async () => undefined) // initial progress
      .mockImplementationOnce(async () => {
        throw new Error("redis exploded");
      });
    await expect(
      h2.commit.commit(
        "t2",
        c2.packageId,
        [{ name: "one", entity: "crm-leads", mapping }],
        "b-2",
      ),
    ).rejects.toThrow("redis exploded");
    spy.mockRestore();
    expect(h2.leads).toHaveLength(2);
    expect(h2.batches.get("b-2")?.inserted).toBe(2);
    expect(h2.items.filter((i) => i.batchId === "b-2")).toHaveLength(2);
    expect((await h2.store.getState("t2", c2.packageId))?.status).toBe(
      "failed",
    );
    expect(st).not.toBeNull();
    for (const x of [h, h2])
      fs.rmSync(x.root, { recursive: true, force: true });
    delete process.env.IMPORT_TMP_DIR;
  }, 30000);
});

// deflateRawSync is imported to keep zlib behaviour explicit for future raw-deflate fixtures.
void deflateRawSync;
