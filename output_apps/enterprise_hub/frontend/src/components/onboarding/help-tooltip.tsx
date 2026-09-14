"use client";

import React, { useState, useEffect, useRef } from "react";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface HelpTooltipProps {
  target: string;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * Contextual help tooltip that provides on-demand assistance for specific UI elements.
 * Features smart positioning, click-to-toggle, and smooth animations.
 */
export function HelpTooltip({ 
  target, 
  content, 
  position = "top",
  className 
}: HelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Find target element and calculate position
  useEffect(() => {
    const element = document.querySelector(target) as HTMLElement;
    if (element) {
      setTargetElement(element);
    }
  }, [target]);

  // Calculate tooltip position based on target element
  useEffect(() => {
    if (!targetElement || !isVisible) return;

    const rect = targetElement.getBoundingClientRect();
    const tooltipRect = tooltipRef.current?.getBoundingClientRect();
    
    if (!tooltipRect) return;

    let top = 0;
    let left = 0;

    switch (position) {
      case "top":
        top = rect.top - tooltipRect.height - 8;
        left = rect.left + (rect.width - tooltipRect.width) / 2;
        break;
      case "bottom":
        top = rect.bottom + 8;
        left = rect.left + (rect.width - tooltipRect.width) / 2;
        break;
      case "left":
        top = rect.top + (rect.height - tooltipRect.height) / 2;
        left = rect.left - tooltipRect.width - 8;
        break;
      case "right":
        top = rect.top + (rect.height - tooltipRect.height) / 2;
        left = rect.right + 8;
        break;
    }

    // Keep tooltip within viewport bounds
    const padding = 16;
    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding));

    setTooltipPosition({ top, left });
  }, [targetElement, isVisible, position]);

  // Close tooltip when clicking outside
  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setIsVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isVisible]);

  // Add help icon to target element
  useEffect(() => {
    if (!targetElement) return;

    const helpIcon = document.createElement("button");
    helpIcon.className = "help-tooltip-trigger absolute -top-2 -right-2 size-5 rounded-full bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 flex items-center justify-center transition-colors z-10";
    helpIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
    helpIcon.setAttribute("aria-label", "راهنما");
    helpIcon.setAttribute("type", "button");
    
    const positionHelpIcon = () => {
      const rect = targetElement.getBoundingClientRect();
      helpIcon.style.position = "fixed";
      helpIcon.style.top = `${rect.top - 8}px`;
      helpIcon.style.left = `${rect.right - 8}px`;
    };

    positionHelpIcon();
    window.addEventListener("resize", positionHelpIcon);
    targetElement.style.position = "relative";
    targetElement.appendChild(helpIcon);

    const handleClick = () => setIsVisible(!isVisible);
    helpIcon.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("resize", positionHelpIcon);
      helpIcon.removeEventListener("click", handleClick);
      if (helpIcon.parentNode === targetElement) {
        targetElement.removeChild(helpIcon);
      }
    };
  }, [targetElement, isVisible]);

  if (!isVisible) return null;

  return (
    <div
      ref={tooltipRef}
      className={cn(
        "fixed z-50 w-72 rounded-xl border border-amber-400/30 bg-[#0E1626] p-4 shadow-2xl animate-in fade-in zoom-in duration-200",
        className
      )}
      style={{
        top: tooltipPosition.top,
        left: tooltipPosition.left,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-amber-400/20 text-amber-300">
          <Info className="size-3.5" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-slate-300 leading-relaxed">{content}</p>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="flex size-5 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors shrink-0"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}