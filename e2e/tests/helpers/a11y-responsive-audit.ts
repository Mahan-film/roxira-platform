import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function getAuditOutputDir(): string {
  if (process.env.A11Y_AUDIT_DIR) {
    return process.env.A11Y_AUDIT_DIR;
  }
  return path.join(process.cwd(), 'tmp', 'roxira-a11y-audit');
}

export function getMockAuthSession(): string {
  const payload = {
    sub: '00000000-0000-0000-0000-000000000001',
    role: 'ADMIN',
    tenantRole: 'OWNER',
    tenantId: '00000000-0000-0000-0000-000000000001',
    exp: Math.floor(Date.now() / 1000) + 86400 * 30,
  };
  const token = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.mocksig`;
  return JSON.stringify({
    accessToken: token,
    tokenType: 'Bearer',
    expiresAt: Date.now() + 86400 * 30 * 1000,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      displayName: 'Audit Admin',
      email: 'audit@roxira.ir',
      phone: '09120000000',
      role: 'ADMIN',
      serviceDomain: 'ROXIRA',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
}

export interface PageGroup {
  name: string;
  slug: string;
  isProtected?: boolean;
  routes: string[];
}

export const AUDITED_PAGE_GROUPS: PageGroup[] = [
  {
    name: 'Public & Marketing',
    slug: 'public',
    isProtected: false,
    routes: ['/', '/about', '/services', '/contact', '/terms', '/privacy', '/plans', '/technology'],
  },
  {
    name: 'Authentication & Portal',
    slug: 'auth',
    isProtected: false,
    routes: ['/login', '/signup', '/reset-password', '/app/onboarding'],
  },
  {
    name: 'Legal & Smart Judge',
    slug: 'legal',
    isProtected: false,
    routes: ['/judge', '/chat', '/laws', '/precedents', '/regulations', '/coverage', '/radar'],
  },
  {
    name: 'Invoicing & Sales',
    slug: 'invoicing',
    isProtected: true,
    routes: ['/app/invoicing', '/app/invoicing/pos', '/app/crm'],
  },
  {
    name: 'Treasury & Banking',
    slug: 'treasury',
    isProtected: true,
    routes: ['/app/treasury', '/app/treasury/cash-boxes', '/app/treasury/petty-cash', '/app/cheques'],
  },
  {
    name: 'Accounting & Ledger',
    slug: 'accounting',
    isProtected: true,
    routes: [
      '/app/accounting',
      '/app/accounting/chart',
      '/app/accounting/vouchers',
      '/app/accounting/reports',
      '/app/accounting/fiscal-years',
      '/app/accounting/fixed-assets',
    ],
  },
  {
    name: 'Tax Compliance',
    slug: 'tax',
    isProtected: true,
    routes: [
      '/app/tax',
      '/app/tax/electronic-books',
      '/app/tax/kartable',
      '/app/tax/previews',
      '/app/tax/wizard',
    ],
  },
  {
    name: 'Settings & Organization',
    slug: 'settings',
    isProtected: true,
    routes: [
      '/app/settings',
      '/app/settings/members',
      '/app/settings/modules',
      '/app/settings/policies',
      '/app/settings/security',
      '/app/settings/audit',
      '/app/import',
    ],
  },
];

export interface PageAuditFinding {
  route: string;
  group: string;
  viewportWidth: number;
  direction: 'rtl' | 'ltr';
  hasHorizontalOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  overflowElements: string[];
  clippedTextCount: number;
  clippedSnippets: string[];
  axeViolations: Array<{
    id: string;
    impact: string;
    description: string;
    helpUrl: string;
    nodesCount: number;
  }>;
  screenshotPath: string;
}

export async function detectHorizontalOverflow(page: Page): Promise<{
  hasOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  offenders: string[];
}> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc ? doc.scrollWidth : 0, body ? body.scrollWidth : 0);
    const clientWidth = doc ? doc.clientWidth : window.innerWidth;
    const hasOverflow = scrollWidth > clientWidth + 2; // subpixel tolerance

    const offenders: string[] = [];
    if (hasOverflow) {
      const all = document.querySelectorAll('*');
      for (let i = 0; i < all.length && offenders.length < 5; i++) {
        const el = all[i];
        const rect = el.getBoundingClientRect();
        if (rect.right > clientWidth + 2 || rect.left < -2) {
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
          offenders.push(`${el.tagName.toLowerCase()}${id}${cls} (w:${Math.round(rect.width)}, l:${Math.round(rect.left)})`);
        }
      }
    }

    return { hasOverflow, scrollWidth, clientWidth, offenders };
  });
}

export async function detectClippedText(page: Page): Promise<{
  count: number;
  snippets: string[];
}> {
  return page.evaluate(() => {
    const selectors = 'p, span, h1, h2, h3, h4, h5, h6, button, a, label, div';
    const elements = document.querySelectorAll(selectors);
    const snippets: string[] = [];

    for (let i = 0; i < elements.length && snippets.length < 5; i++) {
      const el = elements[i];
      const text = (el.textContent || '').trim();
      if (text.length > 3 && el.scrollWidth > el.clientWidth + 3) {
        const style = window.getComputedStyle(el);
        if (style.overflow !== 'hidden' && style.textOverflow !== 'ellipsis' && style.display !== 'inline') {
          snippets.push(`[${el.tagName.toLowerCase()}] "${text.slice(0, 40)}..."`);
        }
      }
    }

    return { count: snippets.length, snippets };
  });
}

export async function runAxeAudit(page: Page): Promise<
  Array<{
    id: string;
    impact: string;
    description: string;
    helpUrl: string;
    nodesCount: number;
  }>
> {
  try {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    return results.violations.map((v) => ({
      id: v.id,
      impact: v.impact || 'minor',
      description: v.description,
      helpUrl: v.helpUrl,
      nodesCount: v.nodes.length,
    }));
  } catch (err: any) {
    return [
      {
        id: 'axe-analysis-failed',
        impact: 'minor',
        description: `Axe scan could not execute: ${err.message}`,
        helpUrl: '',
        nodesCount: 0,
      },
    ];
  }
}

export function saveAuditReport(findings: PageAuditFinding[]): { reportPath: string; issuesDir: string } {
  const auditOutputDir = getAuditOutputDir();
  fs.mkdirSync(auditOutputDir, { recursive: true });
  const reportPath = path.join(auditOutputDir, 'audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(findings, null, 2), 'utf8');

  const issuesDir = path.join(auditOutputDir, 'issues');
  fs.mkdirSync(issuesDir, { recursive: true });

  const grouped = new Map<string, PageAuditFinding[]>();
  for (const f of findings) {
    const list = grouped.get(f.group) || [];
    list.push(f);
    grouped.set(f.group, list);
  }

  for (const [group, items] of Array.from(grouped.entries())) {
    const severityOrder = ['critical', 'serious', 'moderate', 'minor'];
    const lines: string[] = [
      `# Accessibility, RTL & Responsive Width Audit: ${group}`,
      `\nTotal checks performed: ${items.length}\n`,
      '## Findings Ordered by Severity\n',
    ];

    let defectCount = 0;
    for (const sev of severityOrder) {
      const matching = items.flatMap((item) =>
        item.axeViolations
          .filter((v) => v.impact.toLowerCase() === sev)
          .map((v) => ({ item, violation: v })),
      );

      if (matching.length > 0) {
        lines.push(`### [Severity: ${sev.toUpperCase()}]`);
        for (const { item, violation } of matching) {
          defectCount++;
          lines.push(
            `- **${item.route}** (${item.viewportWidth}px, ${item.direction.toUpperCase()}): ${violation.id} - ${violation.description} (${violation.nodesCount} elements)`,
          );
        }
        lines.push('');
      }
    }

    const overflows = items.filter((i) => i.hasHorizontalOverflow);
    if (overflows.length > 0) {
      lines.push('### [Layout: Horizontal Scroll & Overflow on Mobile]');
      for (const ov of overflows) {
        defectCount++;
        lines.push(
          `- **${ov.route}** (${ov.viewportWidth}px, ${ov.direction.toUpperCase()}): scrollWidth=${ov.scrollWidth}px > clientWidth=${ov.clientWidth}px`,
        );
        if (ov.overflowElements.length > 0) {
          lines.push(`  Offenders: ${ov.overflowElements.join(', ')}`);
        }
      }
      lines.push('');
    }

    const clipped = items.filter((i) => i.clippedTextCount > 0);
    if (clipped.length > 0) {
      lines.push('### [Layout: Clipped Text / Missing Truncation]');
      for (const cl of clipped) {
        defectCount++;
        lines.push(
          `- **${cl.route}** (${cl.viewportWidth}px, ${cl.direction.toUpperCase()}): ${cl.clippedTextCount} clipped element(s)`,
        );
        lines.push(`  Snippets: ${cl.clippedSnippets.join(', ')}`);
      }
      lines.push('');
    }

    if (defectCount === 0) {
      lines.push('No critical accessibility, overflow, or clipping violations found in this group.\n');
    }

    const issueFile = path.join(issuesDir, `issue-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`);
    fs.writeFileSync(issueFile, lines.join('\n'), 'utf8');
  }

  return { reportPath, issuesDir };
}
