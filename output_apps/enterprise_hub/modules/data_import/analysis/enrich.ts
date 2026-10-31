/**
 * غنی‌سازی تحلیل بسته پس از `analysePackage`: پیشنهاد خواننده (IIF/OFX)، پروفایل محصول، حافظهٔ
 * نگاشت مستأجر، واحد پول (ریال/تومان) و تقویم تاریخ. اولویت: حافظهٔ مستأجر > خواننده > پروفایل > حدس سربرگ.
 */

import { PackageTableReader, stringifyCell } from '../parsers/package-source.types';
import { detectDateSystem } from '../readers/persian/date-system';
import { detectMoneyUnit } from '../readers/persian/money-unit';
import { matchSourceProfile } from '../readers/profiles/source-profiles';
import { EntityImportAdapter } from '../registry/import-registry.types';
import { PackageTableAnalysis } from './package-analysis';
import { headerSignature, RememberedMapping } from '../services/mapping-memory.service';

const SAMPLE = 50;

export type MemoryLookup = (signature: string) => Promise<RememberedMapping | null>;

function fullMapping(headers: string[], partial: Record<string, string | null>): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  for (const header of headers) mapping[header] = partial[header] ?? null;
  return mapping;
}

export async function enrichTables(
  readers: PackageTableReader[],
  analyses: PackageTableAnalysis[],
  adapters: EntityImportAdapter[],
  recall?: MemoryLookup,
): Promise<PackageTableAnalysis[]> {
  const out: PackageTableAnalysis[] = [];
  for (const analysis of analyses) {
    const reader = readers.find((r) => r.name === analysis.name);
    const headers = analysis.columns.map((c) => c.name);
    const next: PackageTableAnalysis = {
      ...analysis,
      signature: headerSignature(headers),
      mappingSource: analysis.detectedEntity ? 'heuristic' : undefined,
    };
    const notes: string[] = [];

    const profile = matchSourceProfile(headers);
    if (reader?.hint) {
      next.detectedEntity = reader.hint.entity;
      next.mapping = fullMapping(headers, reader.hint.mapping);
      next.confidence = 0.99;
      next.mappingSource = 'reader';
      next.reason = undefined;
      notes.push(reader.hint.reasonFa);
    } else if (profile && adapters.some((a) => a.key === profile.profile.entity)) {
      next.detectedEntity = profile.profile.entity;
      next.mapping = fullMapping(headers, profile.mapping);
      next.confidence = profile.profile.evidence === 'proven' ? 0.95 : 0.7;
      next.mappingSource = 'profile';
      next.profileId = profile.profile.id;
      next.profileEvidence = profile.profile.evidence;
      next.reason = undefined;
      notes.push(
        `${profile.profile.titleFa} — ${profile.profile.evidence === 'proven' ? 'تأییدشده با فایل واقعی' : 'تقریبی: با خروجی واقعی این محصول آزمایش نشده؛ نگاشت را بررسی کنید'}.`,
        ...profile.profile.warningsFa,
      );
    }

    if (recall && next.signature) {
      const remembered = await recall(next.signature);
      const adapter = remembered ? adapters.find((a) => a.key === remembered.entity) : undefined;
      if (remembered && adapter) {
        const known = new Set(adapter.fields.map((f) => f.key));
        const mapping: Record<string, string | null> = {};
        for (const header of headers) {
          const field = remembered.mapping[header];
          mapping[header] = field && known.has(field) ? field : null;
        }
        next.detectedEntity = remembered.entity;
        next.mapping = mapping;
        next.confidence = 1;
        next.mappingSource = 'memory';
        next.reason = undefined;
        notes.push('این ساختار ستونی را پیش‌تر برای همین سازمان نگاشت کرده‌اید؛ همان نگاشت اعمال شد.');
      }
    }

    // money unit + date system of the mapped columns (never converts anything by itself)
    const adapter = next.detectedEntity ? adapters.find((a) => a.key === next.detectedEntity) : undefined;
    if (adapter && reader) {
      const fieldType = new Map(adapter.fields.map((f) => [f.key, f.type]));
      const page = reader.readPage(0, SAMPLE);
      const moneyColumns = headers.filter((h) => fieldType.get(next.mapping[h] ?? '') === 'money');
      let unit: PackageTableAnalysis['moneyUnit'];
      for (const column of moneyColumns) {
        const guess = detectMoneyUnit(column, page.map((row) => stringifyCell(row[column])));
        if (!unit || (unit.unit === 'unknown' && guess.unit !== 'unknown')) {
          unit = { unit: guess.unit, toRial: guess.toRial, evidence: guess.evidence, column };
        }
      }
      if (unit) next.moneyUnit = unit;
      const dateColumns = headers.filter((h) => fieldType.get(next.mapping[h] ?? '') === 'date');
      if (dateColumns.length > 0) {
        const values = dateColumns.flatMap((c) => page.map((row) => stringifyCell(row[c])));
        next.dateSystem = detectDateSystem(values).system;
        if (next.dateSystem === 'mixed') {
          notes.push('تاریخ‌ها هم جلالی و هم میلادی‌اند؛ پیش از ثبت بررسی کنید.');
        }
      }
    }
    if (notes.length > 0) next.notesFa = notes;
    out.push(next);
  }
  return out;
}
