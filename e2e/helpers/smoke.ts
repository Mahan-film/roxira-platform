import AxeBuilder from '@axe-core/playwright';
import { expect, type ConsoleMessage, type Page, type Response } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const BENIGN_CONSOLE_ERRORS: RegExp[] = [
  /favicon\.ico/i,
  /umami/i,
  /net::ERR_ABORTED/i,
  /Download the React DevTools/i,
  /Failed to load resource: net::ERR_CONNECTION_REFUSED/i,
];

export const SESSION_STORAGE_KEY = 'roxira.auth.session';

export interface A11yBaseline {
  route: string;
  totalViolations: number;
  rules: Record<string, number>;
}

export interface SmokeOptions {
  /** Base URL override (defaults to Playwright baseURL or http://127.0.0.1:3001) */
  baseURL?: string;
  /** Directory containing a11y baseline JSON files (defaults to e2e/a11y-baseline) */
  baselineDir?: string;
  /** Selector for h1 or main landmark (defaults to 'h1, main, [role="main"]') */
  landmarkSelector?: string;
  /** Extra benign console error patterns to ignore */
  allowedConsoleErrors?: (string | RegExp)[];
  /** Wait until state for page navigation (defaults to 'domcontentloaded') */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Timeout in ms for landmark visibility check (defaults to 10000) */
  timeout?: number;
  /** Session JSON string or path to session file to inject into localStorage */
  sessionFile?: string;
  sessionRaw?: string;
  /** Axe rule tags to check (defaults to ['wcag2a', 'wcag2aa']) */
  axeTags?: string[];
  /** Skip axe accessibility scan if explicitly false */
  checkA11y?: boolean;
}

export interface SmokeResult {
  route: string;
  status: number;
  totalViolations: number;
  rules: Record<string, number>;
  violations: unknown[];
}

/**
 * Finds the a11y baseline directory by checking standard relative locations.
 */
export function findA11yBaselineDir(customDir?: string): string {
  if (customDir) return path.resolve(customDir);
  const candidates = [
    path.resolve(process.cwd(), 'a11y-baseline'),
    path.resolve(process.cwd(), 'e2e/a11y-baseline'),
    path.resolve(__dirname, '../a11y-baseline'),
    path.resolve(__dirname, '../../a11y-baseline'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(__dirname, '../a11y-baseline');
}

/**
 * Maps a route string (e.g. '/', '/about', '/app/reports') to a baseline JSON file path.
 */
export function routeToBaselinePath(route: string, baselineDir: string): string {
  const clean = route.replace(/^\/+|\/+$/g, '');
  if (!clean) {
    const rootPath = path.join(baselineDir, 'root.json');
    const indexPath = path.join(baselineDir, 'index.json');
    if (fs.existsSync(indexPath) && !fs.existsSync(rootPath)) return indexPath;
    return rootPath;
  }

  // Check nested: e.g. e2e/a11y-baseline/app/reports.json
  const nested = path.join(baselineDir, `${clean}.json`);
  if (fs.existsSync(nested)) return nested;

  // Check flat: e.g. e2e/a11y-baseline/app-reports.json
  const flatSlug = clean.replace(/[\/\\]+/g, '-');
  const flatPath = path.join(baselineDir, `${flatSlug}.json`);
  if (fs.existsSync(flatPath)) return flatPath;

  return flatPath;
}

/**
 * Parses a baseline JSON file tolerating multiple standard formats.
 */
export function parseBaseline(raw: string, route: string): A11yBaseline {
  const data = JSON.parse(raw);
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid baseline JSON: expected object');
  }

  const total =
    typeof data.totalViolations === 'number'
      ? data.totalViolations
      : typeof data.maxTotal === 'number'
        ? data.maxTotal
        : typeof data.maxViolations === 'number'
          ? data.maxViolations
          : undefined;

  let rules: Record<string, number> = {};
  if (data.rules && typeof data.rules === 'object') {
    rules = data.rules;
  } else if (data.violations && typeof data.violations === 'object' && !Array.isArray(data.violations)) {
    rules = data.violations;
  } else if (data.violations && Array.isArray(data.violations)) {
    for (const item of data.violations) {
      if (item && item.id && typeof item.count === 'number') {
        rules[item.id] = item.count;
      }
    }
  } else {
    for (const [k, v] of Object.entries(data)) {
      if (k !== 'route' && typeof v === 'number') {
        rules[k] = v;
      }
    }
  }

  const computedTotal = total ?? Object.values(rules).reduce((a, b) => a + b, 0);
  return {
    route: data.route ?? route,
    totalViolations: computedTotal,
    rules,
  };
}

/**
 * Core smoke helper function.
 * Checks:
 *  1. Page renders an h1 or main landmark;
 *  2. No console errors (excluding benign noise);
 *  3. No HTTP response >= 500;
 *  4. Axe wcag2a / wcag2aa violations are no more than the route's baseline in e2e/a11y-baseline/<route>.json.
 *
 * Supports both signatures:
 *   await smoke(page, '/about')
 *   await smoke('/about', { page })
 */
export async function smoke(
  pageOrRoute: Page | string,
  routeOrFixtures?: string | { page: Page },
  options?: SmokeOptions
): Promise<SmokeResult> {
  let page: Page;
  let route: string;
  const opts = options ?? {};

  if (typeof pageOrRoute === 'string') {
    route = pageOrRoute;
    if (routeOrFixtures && typeof routeOrFixtures === 'object' && 'page' in routeOrFixtures) {
      page = routeOrFixtures.page;
    } else {
      throw new Error('smoke(route, { page }, options) requires { page } as second argument');
    }
  } else {
    page = pageOrRoute;
    if (typeof routeOrFixtures !== 'string') {
      throw new Error('smoke(page, route, options) requires route string as second argument');
    }
    route = routeOrFixtures;
  }

  const consoleErrors: string[] = [];
  const serverErrors: { url: string; status: number }[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const allowed = [...BENIGN_CONSOLE_ERRORS, ...(opts.allowedConsoleErrors ?? [])];
      const isAllowed = allowed.some((pat) => (typeof pat === 'string' ? text.includes(pat) : pat.test(text)));
      if (!isAllowed) {
        consoleErrors.push(text);
      }
    }
  };

  const onPageError = (err: Error) => {
    const text = err.message || String(err);
    const allowed = [...BENIGN_CONSOLE_ERRORS, ...(opts.allowedConsoleErrors ?? [])];
    const isAllowed = allowed.some((pat) => (typeof pat === 'string' ? text.includes(pat) : pat.test(text)));
    if (!isAllowed) {
      consoleErrors.push(text);
    }
  };

  const onResponse = (resp: Response) => {
    if (resp.status() >= 500) {
      serverErrors.push({ url: resp.url(), status: resp.status() });
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  try {
    // Optional session injection (reusing auth session format)
    let rawSession: string | undefined = opts.sessionRaw;
    if (!rawSession && opts.sessionFile && fs.existsSync(opts.sessionFile)) {
      rawSession = fs.readFileSync(opts.sessionFile, 'utf8');
    }
    if (rawSession) {
      await page.context().addInitScript(
        ([key, val]) => {
          try {
            window.localStorage.setItem(key, val);
          } catch {
            /* storage unavailable */
          }
        },
        [SESSION_STORAGE_KEY, rawSession] as const
      );
    }

    const response = await page.goto(route, {
      waitUntil: opts.waitUntil ?? 'domcontentloaded',
      timeout: opts.timeout ?? 30_000,
    });

    const status = response ? response.status() : 200;
    if (status >= 500) {
      serverErrors.push({ url: page.url(), status });
    }

    // Check: No HTTP responses >= 500
    expect(
      serverErrors,
      `Page "${route}" encountered HTTP >= 500 response(s): ${serverErrors.map((s) => `${s.status} ${s.url}`).join(', ')}`
    ).toEqual([]);

    // Check: The page renders an h1 or main landmark
    const landmarkSelector = opts.landmarkSelector ?? 'h1, main, [role="main"]';
    const landmark = page.locator(landmarkSelector);
    await expect(
      landmark.first(),
      `Page at route "${route}" did not render an h1 or main landmark (checked selector: "${landmarkSelector}")`
    ).toBeVisible({ timeout: opts.timeout ?? 10_000 });

    // Check: No console error
    expect(
      consoleErrors,
      `Page at route "${route}" produced console error(s): ${consoleErrors.join(' | ')}`
    ).toEqual([]);

    // Check: Axe wcag2a / wcag2aa violations
    let actualTotal = 0;
    const actualRules: Record<string, number> = {};
    let violations: unknown[] = [];

    if (opts.checkA11y !== false) {
      const axe = new AxeBuilder({ page }).withTags(opts.axeTags ?? ['wcag2a', 'wcag2aa']);
      const results = await axe.analyze();
      violations = results.violations;

      for (const v of results.violations) {
        const count = v.nodes.length;
        actualRules[v.id] = (actualRules[v.id] ?? 0) + count;
        actualTotal += count;
      }

      const baselineDir = findA11yBaselineDir(opts.baselineDir);
      const baselinePath = routeToBaselinePath(route, baselineDir);

      if (!fs.existsSync(baselinePath)) {
        if (process.env.UPDATE_A11Y_BASELINES === '1') {
          const newBaseline: A11yBaseline = {
            route,
            totalViolations: actualTotal,
            rules: actualRules,
          };
          fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
          fs.writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 2) + '\n', 'utf8');
          return { route, status, totalViolations: actualTotal, rules: actualRules, violations };
        }
        throw new Error(
          `A11y baseline file missing for route "${route}" at ${baselinePath}.\n` +
          `Detected ${actualTotal} violation(s). Create ${baselinePath} or run with UPDATE_A11Y_BASELINES=1.`
        );
      }

      const rawBaseline = fs.readFileSync(baselinePath, 'utf8');
      const baseline = parseBaseline(rawBaseline, route);

      // Check total violations <= baseline.totalViolations (the baseline can only go down)
      expect(
        actualTotal,
        `A11y total violations on "${route}" exceeded baseline (${actualTotal} > ${baseline.totalViolations}).\n` +
        `Violations: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length, impact: v.impact })), null, 2)}`
      ).toBeLessThanOrEqual(baseline.totalViolations);

      // Check per-rule counts <= baseline.rules[ruleId]
      for (const [ruleId, count] of Object.entries(actualRules)) {
        const maxAllowed = baseline.rules?.[ruleId] ?? 0;
        expect(
          count,
          `A11y rule "${ruleId}" on "${route}" exceeded baseline count (${count} > ${maxAllowed})`
        ).toBeLessThanOrEqual(maxAllowed);
      }

      // If ratcheted down and UPDATE_A11Y_BASELINES=1, save new lower baseline
      if (process.env.UPDATE_A11Y_BASELINES === '1' && actualTotal < baseline.totalViolations) {
        const ratcheted: A11yBaseline = {
          route,
          totalViolations: actualTotal,
          rules: actualRules,
        };
        fs.writeFileSync(baselinePath, JSON.stringify(ratcheted, null, 2) + '\n', 'utf8');
      }
    }

    return { route, status, totalViolations: actualTotal, rules: actualRules, violations };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}
