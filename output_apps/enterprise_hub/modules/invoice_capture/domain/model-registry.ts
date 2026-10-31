import * as fs from 'fs';
import * as path from 'path';

/** One model of a role in `config/models.yaml` (ids and prices live ONLY there). */
export interface RegistryModel {
  id: string;
  /** USD per 1M tokens. */
  priceIn: number;
  priceOut: number;
}

/** Light parse of one role: `- id:` lines and their `price_per_1m: { in: x, out: y }`. */
export function readRoleModels(yamlText: string, role: string): RegistryModel[] {
  const models: RegistryModel[] = [];
  let inRole = false;
  let current: RegistryModel | null = null;
  for (const raw of yamlText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) {
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (indent <= 2) {
      const roleMatch = /^([A-Za-z0-9_]+):\s*$/.exec(trimmed);
      inRole = indent === 2 && roleMatch?.[1] === role;
      current = null;
      continue;
    }
    if (!inRole) {
      continue;
    }
    const idMatch = /^-\s*id:\s*(\S+)\s*$/.exec(trimmed);
    if (idMatch) {
      current = { id: idMatch[1].replace(/^['"]|['"]$/g, ''), priceIn: 0, priceOut: 0 };
      models.push(current);
      continue;
    }
    const price = /price_per_1m:\s*\{\s*in:\s*([\d.]+)\s*,\s*out:\s*([\d.]+)/.exec(trimmed);
    if (price && current) {
      current.priceIn = Number(price[1]);
      current.priceOut = Number(price[2]);
    }
  }
  return models;
}

/** Candidate locations of the registry (explicit env, cwd, repo layouts, production mount). */
export function registryPaths(explicit?: string): string[] {
  return [
    ...(explicit ? [explicit] : []),
    path.resolve(process.cwd(), 'config/models.yaml'),
    path.resolve(process.cwd(), '../../config/models.yaml'),
    path.resolve(__dirname, '../../../../../config/models.yaml'),
    path.resolve(__dirname, '../../../../../../config/models.yaml'),
    '/opt/roxira_platform/config/models.yaml',
  ];
}

export function loadRoleModels(role: string, explicit?: string): RegistryModel[] {
  for (const file of registryPaths(explicit)) {
    try {
      const found = readRoleModels(fs.readFileSync(file, 'utf8'), role);
      if (found.length > 0) {
        return found;
      }
    } catch {
      // unreadable candidate: try the next one
    }
  }
  return [];
}

/** Free-tier models first (at most `maxFree`), then every paid model: the paid fallback is never dropped. */
export function orderFreeFirst(models: RegistryModel[], maxFree: number): RegistryModel[] {
  const isFree = (m: RegistryModel): boolean => m.priceIn === 0 && m.priceOut === 0;
  return [...models.filter(isFree).slice(0, maxFree), ...models.filter((m) => !isFree(m))];
}

export function costUsd(model: RegistryModel, tokensIn: number, tokensOut: number): number {
  return (tokensIn * model.priceIn + tokensOut * model.priceOut) / 1_000_000;
}
