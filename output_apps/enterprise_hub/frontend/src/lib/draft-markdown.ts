// Tiny markdown subset (headings, bullets, quotes, **bold**) shared by the draft preview,
// the print/PDF window and the client-side .docx generator. No dependency, no raw HTML:
// every output path escapes text, so model output can never inject markup.

export type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "li"; text: string }
  | { kind: "quote"; text: string };

export type Span = { text: string; bold: boolean };

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2] });
      continue;
    }
    const li = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      blocks.push({ kind: "li", text: li[1] });
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      blocks.push({ kind: "quote", text: line.replace(/^>+\s?/, "") });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

export function inlineSpans(text: string): Span[] {
  return text
    .split(/\*\*/)
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter((s) => s.text);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Self-contained printable HTML (used for "print / save as PDF"). */
export function markdownToHtml(md: string, title: string): string {
  const spans = (t: string) =>
    inlineSpans(t)
      .map((s) => (s.bold ? `<strong>${escapeHtml(s.text)}</strong>` : escapeHtml(s.text)))
      .join("");
  const body = parseMarkdown(md)
    .map((b) => {
      switch (b.kind) {
        case "h":
          return `<h${b.level}>${spans(b.text)}</h${b.level}>`;
        case "li":
          return `<p class="li">• ${spans(b.text)}</p>`;
        case "quote":
          return `<blockquote>${spans(b.text)}</blockquote>`;
        default:
          return `<p>${spans(b.text)}</p>`;
      }
    })
    .join("\n");
  return (
    `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>body{font-family:Vazirmatn,Tahoma,Arial,sans-serif;line-height:2;margin:2.2cm;color:#111}` +
    `h1,h2,h3{margin:1.2em 0 .4em}p{margin:.3em 0;text-align:justify}.li{padding-inline-start:1em}` +
    `blockquote{margin:0 0 1em;padding:.4em 1em;border-inline-start:3px solid #999;color:#444;font-size:.85em}` +
    `@media print{body{margin:1.5cm}}</style></head><body>${body}</body></html>`
  );
}

/* ----------------------------------- .docx ---------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Store-only (uncompressed) ZIP archive. Enough for a .docx; no dependency. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...common, ...name]);
    chunks.push(local, f.data);
    central.push(
      new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...common.slice(0, 26), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]),
    );
    offset += local.length + f.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of all) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

const xmlEscape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runXml(text: string, bold: boolean, size: number): string {
  const rpr =
    `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? "<w:b/><w:bCs/>" : ""}<w:rtl/>` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

export function markdownToDocumentXml(md: string): string {
  const paras = parseMarkdown(md).map((b) => {
    const base = b.kind === "h" ? (b.level === 1 ? 32 : b.level === 2 ? 28 : 26) : b.kind === "quote" ? 20 : 24;
    const text = b.kind === "li" ? `• ${b.text}` : b.text;
    const runs = inlineSpans(text)
      .map((s) => runXml(s.text, s.bold || b.kind === "h", base))
      .join("");
    return `<w:p><w:pPr><w:bidi/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join("")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/><w:bidi/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

export function buildDocx(md: string): Blob {
  const enc = new TextEncoder();
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
    },
    { name: "word/document.xml", data: enc.encode(markdownToDocumentXml(md)) },
  ];
  const bytes = zipStore(files);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open a print window (browser "Save as PDF"). Returns false when the popup was blocked. */
export function printHtml(html: string): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  window.setTimeout(() => w.print(), 300);
  return true;
}
