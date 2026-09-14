"use client";

import React, { useState } from "react";
import { BookOpen, Scale, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface LegalReference {
  title: string;
  category?: string;
  summary?: string;
  type?: "law" | "precedent";
}

interface LegalReferenceHighlightProps {
  text: string;
  laws?: LegalReference[];
  precedents?: LegalReference[];
  className?: string;
}

/**
 * Interactive legal document preview with clickable statutory articles and judicial precedent highlights.
 * Features clickable references, expandable details, and visual distinction between legal sources.
 */
export function LegalReferenceHighlight({ 
  text, 
  laws = [], 
  precedents = [], 
  className 
}: LegalReferenceHighlightProps) {
  const [activeReference, setActiveReference] = useState<LegalReference | null>(null);
  const [expandedReferences, setExpandedReferences] = useState<Set<string>>(new Set());

  const allReferences = [
    ...laws.map(ref => ({ ...ref, type: "law" as const })),
    ...precedents.map(ref => ({ ...ref, type: "precedent" as const }))
  ];

  const toggleReference = (reference: LegalReference) => {
    if (activeReference?.title === reference.title) {
      setActiveReference(null);
    } else {
      setActiveReference(reference);
    }
  };

  const toggleExpand = (title: string) => {
    setExpandedReferences(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  const highlightText = (content: string): string => {
    let highlighted = content;
    
    // Highlight laws with green color
    laws.forEach(law => {
      const regex = new RegExp(`(${law.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      highlighted = highlighted.replace(regex, 
        `<span class="legal-ref-law cursor-pointer hover:bg-emerald-500/30 bg-emerald-500/20 text-emerald-300 px-1 rounded transition-colors" 
              data-title="${law.title}">$1</span>`
      );
    });

    // Highlight precedents with indigo color
    precedents.forEach(precedent => {
      const regex = new RegExp(`(${precedent.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      highlighted = highlighted.replace(regex, 
        `<span class="legal-ref-precedent cursor-pointer hover:bg-indigo-500/30 bg-indigo-500/20 text-indigo-300 px-1 rounded transition-colors" 
              data-title="${precedent.title}">$1</span>`
      );
    });

    return highlighted;
  };

  const handleReferenceClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('legal-ref-law') || target.classList.contains('legal-ref-precedent')) {
      const title = target.getAttribute('data-title');
      const reference = allReferences.find(ref => ref.title === title);
      if (reference) {
        toggleReference(reference);
      }
    }
  };

  return (
    <div className={cn("relative", className)}>
      {/* Main content with highlighted references */}
      <div
        dangerouslySetInnerHTML={{ __html: highlightText(text) }}
        className="text-sm leading-relaxed whitespace-pre-wrap"
        onClick={handleReferenceClick}
      />

      {/* Reference panel */}
      {activeReference && (
        <div className="mt-4 rounded-xl border border-white/10 bg-[#0E1626] p-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              {activeReference.type === "law" ? (
                <BookOpen className="size-4 text-emerald-400" />
              ) : (
                <Scale className="size-4 text-indigo-400" />
              )}
              <span className={cn(
                "text-xs font-bold",
                activeReference.type === "law" ? "text-emerald-300" : "text-indigo-300"
              )}>
                {activeReference.type === "law" ? "مستند قانونی" : "رأی وحدت رویه"}
              </span>
            </div>
            <button
              onClick={() => setActiveReference(null)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          <h4 className="text-sm font-bold text-white mb-2">{activeReference.title}</h4>
          
          {activeReference.category && (
            <div className="text-[11px] text-slate-400 mb-2">
              <span className="inline-block px-2 py-0.5 bg-white/5 rounded">
                {activeReference.category}
              </span>
            </div>
          )}

          {activeReference.summary && (
            <div className="text-xs text-slate-300 leading-relaxed">
              {activeReference.summary}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
            <button
              onClick={() => toggleExpand(activeReference.title)}
              className="text-[11px] text-amber-300 hover:text-amber-200 transition-colors flex items-center gap-1"
            >
              {expandedReferences.has(activeReference.title) ? (
                <>
                  <ChevronUp className="size-3" />
                  نمایش کمتر
                </>
              ) : (
                <>
                  <ChevronDown className="size-3" />
                  نمایش بیشتر
                </>
              )}
            </button>
            <span className="text-[10px] text-slate-500">
              {activeReference.type === "law" ? "قانون مدنی/تجارت" : "دیوان عالی کشور"}
            </span>
          </div>

          {expandedReferences.has(activeReference.title) && (
            <div className="mt-3 p-3 bg-white/5 rounded-lg text-[11px] text-slate-400 animate-in fade-in slide-in-from-top-1 duration-200">
              <p className="mb-2 font-semibold text-slate-300">تحلیل کاربردی:</p>
              <p className="leading-relaxed">
                این مستند حقوقی در پرونده‌های مشابه به‌عنوان مبنای استدلال استفاده شده است 
                و می‌تواند در تدوین لایحه دفاعیه شما مؤثر باشد.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Reference legend */}
      {allReferences.length > 0 && (
        <div className="mt-3 flex items-center gap-4 text-[10px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500/30"></span>
            <span>مواد قانونی</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500/30"></span>
            <span>آرای وحدت رویه</span>
          </div>
          <span className="mr-auto">برای جزئیات کلیک کنید</span>
        </div>
      )}
    </div>
  );
}