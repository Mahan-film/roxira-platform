/* eslint-disable no-console */
/**
 * Evaluation runner:  npx ts-node modules/invoice_capture/eval/run-eval.ts [--live] [--out report.md]
 *
 *  default  offline: the deterministic baseline extractor (no network, no key)
 *  --live   every model of the `invoice_extraction` role of config/models.yaml, one by one, through
 *           the production CaptureLlmService (needs OPENROUTER_API_KEY; sends SYNTHETIC text only).
 */
import * as fs from 'fs';
import { loadRoleModels } from '../domain/model-registry';
import { parseExtraction } from '../domain/extraction-schema';
import { CAPTURE_MODEL_ROLE } from '../constants/capture.constants';
import { CaptureLlmService } from '../services/capture-llm.service';
import { baselineExtract } from './baseline-extractor';
import { buildDataset, EvalCase } from './dataset';
import { EVAL_FIELDS, FieldResult, scoreCase, Summary, summarise } from './score';

interface Run {
  name: string;
  summary: Summary;
  byVariant: Record<string, number>;
  costUsd: number;
}

function grade(testCase: EvalCase, content: string | null): FieldResult | null {
  if (content === null) {
    return null;
  }
  try {
    return scoreCase(parseExtraction(content, testCase.text).draft, testCase.truth);
  } catch {
    return null;
  }
}

function toRun(name: string, cases: EvalCase[], results: Array<FieldResult | null>, costUsd: number): Run {
  const byVariant: Record<string, number> = {};
  const total: Record<string, number> = {};
  cases.forEach((c, i) => {
    total[c.variant] = (total[c.variant] ?? 0) + 1;
    if (results[i] && Object.values(results[i] as FieldResult).every(Boolean)) {
      byVariant[c.variant] = (byVariant[c.variant] ?? 0) + 1;
    }
  });
  for (const v of Object.keys(total)) {
    byVariant[v] = (byVariant[v] ?? 0) / total[v];
  }
  return { name, summary: summarise(results), byVariant, costUsd };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function renderReport(cases: EvalCase[], runs: Run[], live: boolean, notes: string[]): string {
  const out: string[] = [];
  out.push('# Invoice capture: extraction evaluation', '');
  out.push(`Dataset: ${cases.length} synthetic Persian invoices (12 variants x 3 seeds), generated deterministically by \`eval/dataset.ts\`.`);
  out.push('Input is invoice TEXT as OCR or a PDF text layer would deliver it (Persian/Arabic/Latin digits, Jalali dates, toman, OCR letter noise).');
  out.push('Scoring is exact per field after normalisation; there is no partial credit.', '');
  out.push(...notes.map((n) => `> ${n}`), '');
  out.push(`| Run | n | parse failures | ${EVAL_FIELDS.join(' | ')} | all critical | all fields | cost USD |`);
  out.push(`|---|---|---|${EVAL_FIELDS.map(() => '---').join('|')}|---|---|---|`);
  for (const r of runs) {
    out.push(
      `| ${r.name} | ${r.summary.n} | ${r.summary.failures} | ${EVAL_FIELDS.map((f) => pct(r.summary.perField[f])).join(' | ')} | ${pct(r.summary.allCriticalCorrect)} | ${pct(r.summary.allFieldsCorrect)} | ${r.costUsd.toFixed(4)} |`,
    );
  }
  out.push('', '## All-fields-correct rate by variant', '');
  const variants = Object.keys(runs[0]?.byVariant ?? {});
  out.push(`| Run | ${variants.join(' | ')} |`, `|---|${variants.map(() => '---').join('|')}|`);
  for (const r of runs) {
    out.push(`| ${r.name} | ${variants.map((v) => pct(r.byVariant[v] ?? 0)).join(' | ')} |`);
  }
  out.push('', live ? 'Live model runs are listed above.' : '**Live model accuracy was NOT measured in this run.** Run with `--live` and a key.');
  return out.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const outIndex = args.indexOf('--out');
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
  const cases = buildDataset();
  const runs: Run[] = [];
  const notes: string[] = [];

  runs.push(toRun('baseline (regex, not a model)', cases, cases.map((c) => grade(c, baselineExtract(c))), 0));

  if (live) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error('OPENROUTER_API_KEY is required for --live');
    }
    const config = { get: (k: string, d?: string) => process.env[k] ?? d ?? '' };
    const llm = new CaptureLlmService(config as never);
    for (const model of loadRoleModels(CAPTURE_MODEL_ROLE)) {
      let cost = 0;
      const results: Array<FieldResult | null> = [];
      for (const c of cases) {
        try {
          const outcome = await llm.extract({ text: c.text }, (content) => void parseExtraction(content, c.text), model.id);
          cost += outcome.costUsd;
          results.push(grade(c, outcome.content));
        } catch {
          results.push(null);
        }
      }
      runs.push(toRun(model.id, cases, results, cost));
      console.log(`done ${model.id}`);
    }
    notes.push(`Live run on ${new Date().toISOString().slice(0, 10)}; each model called alone (no fallback), text input only.`);
    notes.push('Images (photo/scan) are NOT part of this dataset: vision accuracy remains unmeasured.');
  } else {
    notes.push('Offline run: only the deterministic baseline was executed (scorer + pipeline check, a floor, not a model).');
  }
  const report = renderReport(cases, runs, live, notes);
  if (outFile) {
    fs.writeFileSync(outFile, `${report}\n`);
  }
  console.log(report);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
