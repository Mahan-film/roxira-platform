import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";

// Legal pages are plain markdown in content/legal/<slug>.md - edit the files, not this code.
const SLUGS = ["terms", "privacy", "ai-disclosure"] as const;

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(SLUGS as readonly string[]).includes(slug)) notFound();
  const md = await readFile(path.join(process.cwd(), "content", "legal", `${slug}.md`), "utf8");
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-12 [&_a]:underline [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ms-6 [&_li]:list-disc">
      <ReactMarkdown>{md}</ReactMarkdown>
    </article>
  );
}
