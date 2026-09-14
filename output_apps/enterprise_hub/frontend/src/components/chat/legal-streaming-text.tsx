"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface LegalStreamingTextProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

/**
 * Enhanced streaming text component with legal document formatting.
 * Features professional typing effects, legal paragraph structure, and animated indicators.
 */
export function LegalStreamingText({ content, isStreaming, className }: LegalStreamingTextProps) {
  const [displayedContent, setDisplayedContent] = useState("");
  const [typingIndex, setTypingIndex] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);

  // Typing effect for streaming content
  useEffect(() => {
    if (!isStreaming) {
      setDisplayedContent(content);
      setTypingIndex(content.length);
      return;
    }

    if (typingIndex < content.length) {
      const timer = setTimeout(() => {
        setDisplayedContent(content.slice(0, typingIndex + 1));
        setTypingIndex(typingIndex + 1);
      }, 15); // Typing speed in milliseconds
      return () => clearTimeout(timer);
    }
  }, [content, isStreaming, typingIndex]);

  // Cursor blinking effect
  useEffect(() => {
    if (!isStreaming) return;
    
    const cursorTimer = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 500);
    
    return () => clearInterval(cursorTimer);
  }, [isStreaming]);

  // Format legal content with proper structure
  const formatLegalContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, index) => {
      // Detect legal headings (lines that start with numbers or legal terms)
      const isHeading = /^(ماده|بند|تبصره|هیئت عمومی|رأی وحدت رویه|مستندات قانونی|پیش‌نویس لایحه)/i.test(line.trim());
      const isListItem = /^[-•●○]/.test(line.trim());
      
      return (
        <p
          key={index}
          className={cn(
            "transition-all duration-300 leading-relaxed",
            isHeading && "font-bold text-amber-300 mt-4 mb-2 text-sm",
            isListItem && "mr-4 text-slate-300 text-xs",
            !isHeading && !isListItem && "text-slate-200 text-xs mb-2",
            isStreaming && index === lines.length - 1 && "animate-pulse"
          )}
        >
          {line}
        </p>
      );
    });
  };

  return (
    <div className={cn("relative", className)}>
      <div className="prose prose-invert prose-sm max-w-none">
        {formatLegalContent(displayedContent)}
      </div>
      
      {/* Professional streaming indicator */}
      {isStreaming && (
        <div className="mt-3 flex items-center gap-2 text-amber-400 text-xs">
          <span className="flex items-center gap-1.5">
            <span className={cn(
              "w-1.5 h-1.5 bg-amber-400 rounded-full",
              cursorVisible ? "animate-ping" : "opacity-50"
            )} />
            <span className="animate-pulse">در حال تدوین لایحه</span>
          </span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400 text-[10px]">
            {Math.round((typingIndex / Math.max(content.length, 1)) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}