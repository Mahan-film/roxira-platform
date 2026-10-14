import { Fragment, type ReactNode } from "react";
import Link from "next/link";

/**
 * تجزیه‌گر و رندرکنندهٔ بسیار کوچک مارک‌داون برای راهنماهای حقوقی.
 *
 * فقط زیرمجموعهٔ لازم پشتیبانی می‌شود: سرتیترها، پاراگراف، فهرست‌های
 * نشانه‌دار/شماره‌دار، نقل‌قول و جدول. هیچ HTML خامی رندر نمی‌شود و
 * هر متن پیش از نمایش escape/به‌صورت متن React درج می‌گردد. برای استنادهای
 * «قانون … ماده N» در صورت یافتن قانون در laws-public لینک ساخته می‌شود.
 */

export type CitationResolver = (lawName: string, article: string) => string | null;

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^[-*•]\s+(.*)$/;
const OL_RE = /^(?:[0-9]+|[۰-۹]+)[.)]\s+(.*)$/;
const HR_RE = /^-{3,}$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|?\s*:?-{2,}/.test(line.trim());
}

function parseTable(tableLines: string[]): Block {
  const head = splitRow(tableLines[0]);
  const bodyStart = tableLines.length > 1 && isSeparatorRow(tableLines[1]) ? 2 : 1;
  const rows = tableLines.slice(bodyStart).map(splitRow);
  return { kind: "table", head, rows };
}

export function parseGuideMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || HR_RE.test(line)) {
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "h", level, text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      blocks.push(parseTable(tableLines));
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>+\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = UL_RE.exec(lines[i].trim());
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = OL_RE.exec(lines[i].trim());
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) break;
      if (
        HEADING_RE.test(next) ||
        next.startsWith("|") ||
        next.startsWith(">") ||
        UL_RE.test(next) ||
        OL_RE.test(next) ||
        HR_RE.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      i += 1;
    }
    if (paragraph.length > 0) blocks.push({ kind: "p", text: paragraph.join(" ") });
  }

  return blocks;
}

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const CITATION_RE =
  /(قانون\s+[^\n،.:؛«»()]{2,60}?)\s*[،:]?\s*(?:ماده|مواد)\s*([۰-۹0-9]{1,4})|(?:ماده|مواد)\s*([۰-۹0-9]{1,4})\s+(قانون\s+[^\n،.:؛«»()]{2,60})/g;

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (
    href.startsWith("https://") ||
    href.startsWith("http://") ||
    href.startsWith("mailto:") ||
    href.startsWith("/")
  ) {
    return href;
  }
  return null;
}

interface KeyCounter {
  current: number;
}

function renderCitations(text: string, resolve: CitationResolver, key: KeyCounter): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  CITATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_RE.exec(text)) !== null) {
    const lawName = match[1] ?? match[4];
    const article = match[2] ?? match[3];
    if (match.index > last) nodes.push(<Fragment key={`k${key.current++}`}>{text.slice(last, match.index)}</Fragment>);
    const href = lawName && article ? resolve(lawName, article) : null;
    if (href) {
      nodes.push(
        <Link
          key={`k${key.current++}`}
          href={href}
          className="font-semibold text-amber-300 underline decoration-amber-500/40 underline-offset-4 hover:text-amber-200"
        >
          {match[0]}
        </Link>,
      );
    } else {
      nodes.push(<Fragment key={`k${key.current++}`}>{match[0]}</Fragment>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(<Fragment key={`k${key.current++}`}>{text.slice(last)}</Fragment>);
  return nodes;
}

function renderLinksAndCitations(text: string, resolve: CitationResolver, key: KeyCounter): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(...renderCitations(text.slice(last, match.index), resolve, key));
    const href = safeHref(match[2]);
    if (href) {
      nodes.push(
        <a
          key={`k${key.current++}`}
          href={href}
          rel="nofollow noopener"
          target="_blank"
          className="font-semibold text-amber-300 underline decoration-amber-500/40 underline-offset-4 hover:text-amber-200"
        >
          {match[1]}
        </a>,
      );
    } else {
      nodes.push(<Fragment key={`k${key.current++}`}>{match[1]}</Fragment>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(...renderCitations(text.slice(last), resolve, key));
  return nodes;
}

export function renderInline(text: string, resolve: CitationResolver): ReactNode[] {
  const nodes: ReactNode[] = [];
  const key: KeyCounter = { current: 0 };
  text.split("**").forEach((part, index) => {
    if (!part) return;
    if (index % 2 === 1) {
      nodes.push(
        <strong key={`k${key.current++}`} className="font-bold text-foreground">
          {renderLinksAndCitations(part, resolve, key)}
        </strong>,
      );
    } else {
      nodes.push(...renderLinksAndCitations(part, resolve, key));
    }
  });
  return nodes;
}

function headingClass(level: 1 | 2 | 3): string {
  if (level === 1) return "text-xl font-black text-foreground sm:text-2xl";
  if (level === 2) return "text-lg font-bold text-amber-400 sm:text-xl";
  return "text-base font-bold text-foreground";
}

function QuoteBlock({ lines, resolve }: { lines: string[]; resolve: CitationResolver }): ReactNode {
  const content: ReactNode[] = [];
  let paragraph: string[] = [];
  let key = 0;
  const flush = () => {
    if (paragraph.length > 0) {
      content.push(
        <p key={`qp-${key++}`} className="text-sm leading-relaxed text-amber-100">
          {renderInline(paragraph.join(" "), resolve)}
        </p>,
      );
      paragraph = [];
    }
  };
  for (const line of lines) {
    const heading = HEADING_RE.exec(line.trim());
    if (heading) {
      flush();
      content.push(
        <h3 key={`qh-${key++}`} className="text-base font-bold text-amber-300">
          {renderInline(heading[2], resolve)}
        </h3>,
      );
    } else if (line.trim()) {
      paragraph.push(line.trim());
    }
  }
  flush();
  return (
    <blockquote className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5" role="note">
      {content}
    </blockquote>
  );
}

function TableBlock({ block, resolve }: { block: Extract<Block, { kind: "table" }>; resolve: CitationResolver }): ReactNode {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800" tabIndex={0} role="region" aria-label="جدول (قابل پیمایش)">
      <table className="w-full min-w-[34rem] text-start text-xs sm:text-sm">
        <thead className="bg-slate-800/60 text-slate-200">
          <tr>
            {block.head.map((cell, index) => (
              <th key={index} scope="col" className="px-3 py-2 text-start font-bold">
                {renderInline(cell, resolve)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 text-slate-300">
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-3 py-2 align-top leading-relaxed ${cellIndex === 0 ? "font-semibold text-slate-100" : ""}`}>
                  {renderInline(cell, resolve)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GuideContent({
  markdown,
  resolveCitation,
}: {
  markdown: string;
  resolveCitation: CitationResolver;
}): ReactNode {
  const blocks = parseGuideMarkdown(markdown);
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "h":
            return (
              <h2 key={index} className={headingClass(block.level)}>
                {renderInline(block.text, resolveCitation)}
              </h2>
            );
          case "quote":
            return <QuoteBlock key={index} lines={block.lines} resolve={resolveCitation} />;
          case "ul":
            return (
              <ul key={index} className="list-disc space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item, resolveCitation)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={index} className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item, resolveCitation)}</li>
                ))}
              </ol>
            );
          case "table":
            return <TableBlock key={index} block={block} resolve={resolveCitation} />;
          default:
            return (
              <p key={index} className="text-sm leading-relaxed text-muted-foreground">
                {renderInline(block.text, resolveCitation)}
              </p>
            );
        }
      })}
    </div>
  );
}
