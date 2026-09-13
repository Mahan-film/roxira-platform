import React from "react";
import Link from "next/link";
import { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const readableTitle = slug.replace(/-/g, " ");
  return {
    title: `${readableTitle} | پایگاه جامع قوانین قاضی هوشمند`,
    description: `متن معتبر، تفسیر قضایی و راهبرد حقوقی مرتبط با ${readableTitle} در قوانین جاری جمهوری اسلامی ایران.`,
    alternates: { canonical: `https://ghazihoushmand.ir/laws/${slug}` }
  };
}

export default async function LawArticlePage({ params }: Props) {
  const { slug } = await params;
  const readableTitle = slug.toUpperCase().replace(/-/g, " ");

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans p-6 md:p-12" dir="rtl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Legislation",
            "name": readableTitle,
            "legislationIdentifier": slug,
            "jurisdiction": "IR",
            "isPartOf": "https://ghazihoushmand.ir/laws"
          })
        }}
      />
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Link href="/" className="hover:text-zinc-300">خانه</Link>
          <span>/</span>
          <Link href="/laws" className="hover:text-zinc-300">قوانین معتبر</Link>
          <span>/</span>
          <span className="text-blue-400">{readableTitle}</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <h1 className="text-xl md:text-2xl font-bold text-zinc-100">📜 {readableTitle}</h1>
            <span className="px-3 py-1 bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-xs font-bold rounded-full">
              وضعیت: معتبر و لازم‌الاجرا
            </span>
          </div>

          <div className="p-5 bg-zinc-950 border border-zinc-800/80 rounded-xl text-zinc-300 leading-relaxed text-sm whitespace-pre-wrap">
            متن معتبر و مستند قانونی موضوع {readableTitle} منطبق بر آخرین تنقیح قوانین و مقررات موضوعه کشور.
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <Link
              href={`/?query=تنظیم لایحه بر مبنای ${encodeURIComponent(readableTitle)}`}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white text-center rounded-xl text-sm font-bold transition shadow-lg"
            >
              ⚡ تنظیم هوشمند لایحه بر مبنای این ماده
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
