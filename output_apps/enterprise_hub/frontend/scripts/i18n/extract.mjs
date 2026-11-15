#!/usr/bin/env node
/**
 * Codemod for extracting Persian text literals into next-intl catalogues.
 *
 * Usage:
 *   node scripts/i18n/extract.mjs [--dir <path>] [--dry-run] [--locale-dir <path>]
 *
 * Requirements:
 * • wraps Persian literals found in JSX text, placeholder/title/aria-label/label props and toast calls;
 * • writes stable keys <ns>.<file-slug>.<hash8>;
 * • has --dry-run (counts per file) and --dir <path>;
 * • skips content/, legal text data, tests and comments.
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PERSIAN_REGEX = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const TARGET_PROPS = new Set(['placeholder', 'title', 'aria-label', 'label']);

function parseArgs() {
  const args = process.argv.slice(2);
  let targetDir = 'src/components/layout';
  let dryRun = false;
  let localeDir = 'messages';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      targetDir = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--locale-dir' && args[i + 1]) {
      localeDir = args[++i];
    }
  }
  return { targetDir, dryRun, localeDir };
}

function computeHash8(text) {
  return crypto.createHash('sha256').update(text.trim(), 'utf8').digest('hex').slice(0, 8);
}

function shouldSkipFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  // Skip tests
  if (/\.(test|spec)\.[jt]sx?$/.test(normalized) || normalized.includes('/__tests__/')) {
    return true;
  }
  // Skip content and legal text data
  if (
    normalized.includes('/content/') ||
    normalized.startsWith('content/') ||
    normalized.includes('/lib/seo/laws-') ||
    normalized.includes('/lib/seo/regulations-') ||
    normalized.includes('/court-types')
  ) {
    return true;
  }
  return false;
}

function determineNamespace(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/(?:src\/)?(?:components|app|lib)\/([^\/]+)/);
  if (match) {
    return match[1];
  }
  return 'common';
}

function determineFileSlug(filePath) {
  const base = path.basename(filePath);
  return base.replace(/\.[^.]+$/, '');
}

export async function runCodemod({ targetDir, dryRun, localeDir }) {
  const project = new Project({
    tsConfigFilePath: path.resolve(process.cwd(), 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });

  const fullTargetDir = path.resolve(process.cwd(), targetDir);
  const isDirectory = fs.existsSync(fullTargetDir) && fs.statSync(fullTargetDir).isDirectory();

  if (isDirectory) {
    project.addSourceFilesAtPaths(`${targetDir}/**/*.{ts,tsx}`);
  } else if (fs.existsSync(fullTargetDir)) {
    project.addSourceFileAtPath(fullTargetDir);
  } else {
    console.error(`Target path does not exist: ${targetDir}`);
    process.exit(1);
  }

  const sourceFiles = project.getSourceFiles();
  const summary = [];
  const catalogues = {
    fa: {},
    en: {},
  };

  let totalExtracted = 0;

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    if (shouldSkipFile(filePath)) {
      continue;
    }

    const ns = determineNamespace(filePath);
    const fileSlug = determineFileSlug(filePath);
    if (!catalogues.fa[ns]) {
      catalogues.fa[ns] = {};
      catalogues.en[ns] = {};
    }

    const fileItems = [];

    // 1. Extract from JSX Text nodes
    const jsxTexts = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);
    for (const jsxText of jsxTexts) {
      const rawText = jsxText.getText();
      const trimmed = rawText.trim();
      if (trimmed && PERSIAN_REGEX.test(trimmed)) {
        const hash8 = computeHash8(trimmed);
        const stableKey = `${ns}.${fileSlug}.${hash8}`;
        fileItems.push({
          type: 'jsx-text',
          node: jsxText,
          text: trimmed,
          hash8,
          stableKey,
          ns,
          fileSlug,
        });
      }
    }

    // 2. Extract from JSX attributes: placeholder, title, aria-label, label
    const jsxAttrs = sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute);
    for (const attr of jsxAttrs) {
      const name = attr.getNameNode().getText();
      if (TARGET_PROPS.has(name)) {
        const init = attr.getInitializer();
        if (init && Node.isStringLiteral(init)) {
          const rawText = init.getLiteralText();
          const trimmed = rawText.trim();
          if (trimmed && PERSIAN_REGEX.test(trimmed)) {
            const hash8 = computeHash8(trimmed);
            const stableKey = `${ns}.${fileSlug}.${hash8}`;
            fileItems.push({
              type: 'jsx-attr',
              node: attr,
              text: trimmed,
              hash8,
              stableKey,
              ns,
              fileSlug,
            });
          }
        }
      }
    }

    // 3. Extract from toast calls: toast("..."), toast.success("..."), toast.error("...")
    const callExprs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of callExprs) {
      const exprText = call.getExpression().getText();
      if (exprText === 'toast' || exprText.startsWith('toast.')) {
        const args = call.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          const rawText = args[0].getLiteralText();
          const trimmed = rawText.trim();
          if (trimmed && PERSIAN_REGEX.test(trimmed)) {
            const hash8 = computeHash8(trimmed);
            const stableKey = `${ns}.${fileSlug}.${hash8}`;
            fileItems.push({
              type: 'toast',
              node: args[0],
              text: trimmed,
              hash8,
              stableKey,
              ns,
              fileSlug,
            });
          }
        }
      }
    }

    if (fileItems.length > 0) {
      totalExtracted += fileItems.length;
      summary.push({
        file: path.relative(process.cwd(), filePath),
        count: fileItems.length,
        items: fileItems,
      });

      // Record translations in catalogue
      for (const item of fileItems) {
        if (!catalogues.fa[item.ns][item.fileSlug]) {
          catalogues.fa[item.ns][item.fileSlug] = {};
        }
        catalogues.fa[item.ns][item.fileSlug][item.hash8] = item.text;
        // Flat keys for direct lookup convenience
        catalogues.fa[item.ns][`${item.fileSlug}.${item.hash8}`] = item.text;
        catalogues.fa[item.ns][item.stableKey] = item.text;

        // In English catalogue, initialize if missing
        if (!catalogues.en[item.ns][item.fileSlug]) {
          catalogues.en[item.ns][item.fileSlug] = {};
        }
        if (!catalogues.en[item.ns][item.fileSlug][item.hash8]) {
          catalogues.en[item.ns][item.fileSlug][item.hash8] = item.text;
          catalogues.en[item.ns][`${item.fileSlug}.${item.hash8}`] = item.text;
          catalogues.en[item.ns][item.stableKey] = item.text;
        }
      }

      if (!dryRun) {
        // Apply AST transformations
        for (const item of fileItems) {
          if (item.type === 'jsx-text') {
            item.node.replaceWithText(`{t('${item.fileSlug}.${item.hash8}')}`);
          } else if (item.type === 'jsx-attr') {
            item.node.setInitializer(`{t('${item.fileSlug}.${item.hash8}')}`);
          } else if (item.type === 'toast') {
            item.node.replaceWithText(`t('${item.fileSlug}.${item.hash8}')`);
          }
        }

        // Ensure "use client"; directive exists for hook usage
        const fullText = sourceFile.getFullText();
        if (!fullText.includes('"use client"') && !fullText.includes("'use client'")) {
          sourceFile.insertStatements(0, '"use client";\n');
        }

        // Add useTranslations import if missing
        const hasUseTranslations = sourceFile
          .getImportDeclarations()
          .some((d) => d.getModuleSpecifierValue() === 'next-intl' && d.getNamedImports().some((n) => n.getName() === 'useTranslations'));

        if (!hasUseTranslations) {
          sourceFile.addImportDeclaration({
            moduleSpecifier: 'next-intl',
            namedImports: ['useTranslations'],
          });
        }

        // Inject hook `const t = useTranslations('${ns}');` into component functions
        const functions = [
          ...sourceFile.getFunctions(),
          ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
          ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
        ];

        for (const fn of functions) {
          // Check if function renders JSX or is a top-level component
          const returnsJsx = fn.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 || fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0;
          if (returnsJsx) {
            const body = fn.getBody();
            if (body && Node.isBlock(body)) {
              const bodyText = body.getText();
              if (!bodyText.includes('useTranslations(')) {
                body.insertStatements(0, `const t = useTranslations('${ns}');`);
              }
            }
          }
        }

        sourceFile.saveSync();
      }
    }
  }

  // Load existing catalogues and merge
  const faDir = path.resolve(process.cwd(), localeDir, 'fa');
  const enDir = path.resolve(process.cwd(), localeDir, 'en');

  if (!dryRun) {
    fs.mkdirSync(faDir, { recursive: true });
    fs.mkdirSync(enDir, { recursive: true });

    for (const [ns, content] of Object.entries(catalogues.fa)) {
      const faFile = path.join(faDir, `${ns}.json`);
      let existingFa = {};
      if (fs.existsSync(faFile)) {
        try {
          existingFa = JSON.parse(fs.readFileSync(faFile, 'utf8'));
        } catch {}
      }
      const mergedFa = { ...existingFa, ...content };
      fs.writeFileSync(faFile, JSON.stringify(mergedFa, null, 2) + '\n', 'utf8');

      const enFile = path.join(enDir, `${ns}.json`);
      let existingEn = {};
      if (fs.existsSync(enFile)) {
        try {
          existingEn = JSON.parse(fs.readFileSync(enFile, 'utf8'));
        } catch {}
      }
      const mergedEn = { ...content, ...existingEn };
      fs.writeFileSync(enFile, JSON.stringify(mergedEn, null, 2) + '\n', 'utf8');
    }
  }

  // Print results
  console.log(`\n=== next-intl extraction ${dryRun ? '(DRY RUN)' : ''} ===`);
  for (const s of summary) {
    console.log(`  ${s.file}: ${s.count} literal(s)`);
  }
  console.log(`Total: ${totalExtracted} literal(s) across ${summary.length} file(s)\n`);

  return { totalExtracted, summary, catalogues };
}

// Execute when run as CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs();
  runCodemod(opts).catch((err) => {
    console.error('Extraction failed:', err);
    process.exit(1);
  });
}
