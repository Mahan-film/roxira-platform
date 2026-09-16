/**
 * آزمون یکپارچگی سرتاسری (E2E) موتور قاضی هوشمند — لایه AI Core.
 *
 * هر اندپوینت فعال را زیر پیشوند متعارف `/api/v1/apps/judge` فراخوانی می‌کند،
 * کد وضعیت HTTP 200 و انطباق بدنه پاسخ با اسکیمای واقعی سرویس در پروداکشن را
 * بررسی می‌کند. هیچ فریم‌ورک آزمونی در پروژه نصب نیست؛ این فایل خودبسنده است.
 *
 * اجرا (متغیر محیطی شامل پیشوند کامل `/api/v1/apps/judge` است):
 *   JUDGE_API_BASE_URL=https://ghazihoushmand.ir/api/v1/apps/judge \
 *     npx tsx src/tests/judge-api.test.ts
 */

const BASE_URL = process.env.JUDGE_API_BASE_URL ?? "http://localhost:8000/api/v1/apps/judge";

interface EndpointCase {
  name: string;
  run: () => Promise<void>;
}

type FieldKind = "string" | "number" | "boolean" | "array" | "object";

function judgeUrl(endpoint: string): string {
  return `${BASE_URL.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertShape(name: string, data: unknown, spec: Record<string, FieldKind>): void {
  if (!isRecord(data)) {
    throw new Error(`${name}: response body is not a JSON object`);
  }
  for (const [field, kind] of Object.entries(spec)) {
    const value = data[field];
    const actual =
      value === null
        ? "null"
        : value === undefined
          ? "undefined"
          : Array.isArray(value)
            ? "array"
            : isRecord(value)
              ? "object"
              : (typeof value as FieldKind);
    if (actual !== kind) {
      throw new Error(`${name}: field "${field}" expected ${kind} but received ${actual}`);
    }
  }
}

function assertFirstItem(
  name: string,
  value: unknown,
  spec: Record<string, FieldKind>,
): void {
  if (Array.isArray(value) && value.length > 0) {
    assertShape(`${name}[0]`, value[0], spec);
  }
}

function expectStatus(name: string, res: Response, expected = 200): void {
  if (res.status !== expected) {
    throw new Error(`${name}: expected HTTP ${expected} but received ${res.status}`);
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(judgeUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const STATUTORY_BASIS_ITEM: Record<string, FieldKind> = {
  title: "string",
  category: "string",
  summary: "string",
  match_level: "string",
};

const UNIFIED_PRECEDENT_ITEM: Record<string, FieldKind> = {
  title: "string",
  subject: "string",
  summary: "string",
  match_level: "string",
};

const HEALTH_SCHEMA: Record<string, FieldKind> = {
  status: "string",
  service: "string",
  version: "string",
  connected: "boolean",
  documents_processor: "object",
  legal_graph: "object",
};

const DOCUMENT_ANALYSIS_SCHEMA: Record<string, FieldKind> = {
  status: "string",
  document_type: "string",
  key_findings: "array",
  statutory_basis: "array",
  unified_precedents: "array",
  suggested_action: "string",
  source_documents: "array",
  extracted_text: "string",
  processing: "object",
};

const RETRIAL_SCHEMA: Record<string, FieldKind> = {
  status: "string",
  retrial_eligible: "boolean",
  grounds: "array",
  statutory_basis: "array",
  unified_precedents: "array",
  draft_defense: "string",
};

const DELAY_DAMAGES_SCHEMA: Record<string, FieldKind> = {
  status: "string",
  principal_amount_toman: "number",
  adjusted_amount_toman: "number",
  damages_toman: "number",
  legal_basis: "string",
  inflation_growth_factor: "number",
  statement: "string",
};

async function runDocumentAnalysis(name: string, request: () => Promise<Response>): Promise<void> {
  const res = await request();
  expectStatus(name, res);
  const data: unknown = await res.json();
  assertShape(name, data, DOCUMENT_ANALYSIS_SCHEMA);
  if (isRecord(data)) {
    assertShape(`${name} > processing`, data.processing, {
      docling_available: "boolean",
      documents_parsed: "number",
    });
    assertFirstItem(`${name} > statutory_basis`, data.statutory_basis, STATUTORY_BASIS_ITEM);
    assertFirstItem(`${name} > unified_precedents`, data.unified_precedents, UNIFIED_PRECEDENT_ITEM);
  }
}

const cases: EndpointCase[] = [
  {
    name: "GET /health",
    run: async () => {
      const res = await fetch(judgeUrl("/health"));
      expectStatus("GET /health", res);
      const data: unknown = await res.json();
      assertShape("GET /health", data, HEALTH_SCHEMA);
      if (isRecord(data)) {
        assertShape("GET /health > documents_processor", data.documents_processor, {
          docling_available: "boolean",
          endpoint: "string",
          install_hint: "string",
        });
        assertShape("GET /health > legal_graph", data.legal_graph, {
          engine: "string",
          available: "boolean",
          install_hint: "string",
        });
      }
    },
  },
  {
    name: "POST /analyze-case",
    run: () =>
      runDocumentAnalysis("POST /analyze-case", () =>
        postJson("/analyze-case", {
          case_text: "مطالبه اصل وجه و خسارت تأخیر تأدیه از تاریخ سررسید تا اجرای حکم.",
          engine_tier: "tier1",
          attached_files: [],
        }),
      ),
  },
  {
    name: "POST /build-case-strategy",
    run: () =>
      runDocumentAnalysis("POST /build-case-strategy", async () => {
        const form = new FormData();
        form.append("case_text", "شرح پرونده نمونه جهت تدوین استراتژی چهارگانه حقوقی.");
        form.append("engine_tier", "tier1");
        return fetch(judgeUrl("/build-case-strategy"), { method: "POST", body: form });
      }),
  },
  {
    name: "POST /retrial-evaluate",
    run: async () => {
      const res = await postJson("/retrial-evaluate", {
        retrial_type: "CRIMINAL_474",
        case_description: "ادله جدید کشف‌شده پس از قطعیت رأی.",
        verdict_details: "",
        user_identifier: `e2e-${Date.now()}@example.com`,
        is_verified: true,
      });
      expectStatus("POST /retrial-evaluate", res);
      const data: unknown = await res.json();
      assertShape("POST /retrial-evaluate", data, RETRIAL_SCHEMA);
      if (isRecord(data)) {
        assertFirstItem("POST /retrial-evaluate > statutory_basis", data.statutory_basis, STATUTORY_BASIS_ITEM);
        assertFirstItem("POST /retrial-evaluate > unified_precedents", data.unified_precedents, UNIFIED_PRECEDENT_ITEM);
      }
    },
  },
  {
    name: "POST /calculate-delay-damages",
    run: async () => {
      const res = await postJson("/calculate-delay-damages", {
        principal_amount_irr: 1_000_000_000,
        start_year: 1400,
        end_year: 1403,
      });
      expectStatus("POST /calculate-delay-damages", res);
      const data: unknown = await res.json();
      assertShape("POST /calculate-delay-damages", data, DELAY_DAMAGES_SCHEMA);
    },
  },
];

async function main(): Promise<void> {
  const failures: string[] = [];

  for (const testCase of cases) {
    try {
      await testCase.run();
      console.log(`[PASS] ${testCase.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${testCase.name}: ${message}`);
      console.error(`[FAIL] ${testCase.name} — ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length}/${cases.length} judge endpoint tests failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${cases.length} judge endpoint tests passed (HTTP 200 + live schema).`);
}

void main();
