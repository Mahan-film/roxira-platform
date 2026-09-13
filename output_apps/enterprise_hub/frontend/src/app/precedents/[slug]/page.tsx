import React from "react";
import Link from "next/link";
import { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const readable = slug.replace(/-/g, " ");
  return {
    title: `${readable} دیوان عالی کشور | قاضی هوشمند`,
    description: `متن و استدلال قضایی لازم‌الاتباع ${readable} هیأت عمومی دیوان عالی کشور مستند به ماده ۴۷۱ ق.آ.د.ک.`,
    alternates: { canonical: `https://ghazihoushmand.ir/precedents/${slug}` }
  };
}

export default async function PrecedentDetailPage({ params }: Props) {
  const { slug } = await params;
  const readable = slug.toUpperCase().replace(/-/g, " ");

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans p-6 md:p-12" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Link href="/" className="hover:text-zinc-300">خانه</Link>
          <span>/</span>
          <Link href="/precedents" className="hover:text-zinc-300">آرای وحدت رویه</Link>
          <span>/</span>
          <span className="text-indigo-400">{readable}</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <h1 className="text-xl md:text-2xl font-bold text-zinc-100">🏛️ {readable}</h1>
            <span className="px-3 py-1 bg-indigo-950/80 border border-indigo-500/40 text-indigo-400 text-xs font-bold rounded-full">
              لازم‌الاتباع در کلیه محاکم
            </span>
          </div>

          <div className="p-5 bg-zinc-950 border border-zinc-800/80 rounded-xl text-zinc-300 leading-relaxed text-sm whitespace-pre-wrap">
            مفاد این رأی وحدت رویه برای تمامی شعب دیوان عالی کشور و دادگاه‌ها در موارد مشابه حکم قانون را داشته و لازم‌الاتباع است.
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <Link
              href={`/?query=استناد به ${encodeURIComponent(readable)} در دادخواست`}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-center rounded-xl text-sm font-bold transition shadow-lg"
            >
              ⚡ استناد در لایحه تجدیدنظر / فرجام‌خواهی
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
