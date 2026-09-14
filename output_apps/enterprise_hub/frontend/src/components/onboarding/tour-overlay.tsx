"use client";

import React, { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface TourStep {
  target: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
}

interface TourOverlayProps {
  steps: TourStep[];
  currentStep: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  className?: string;
}

/**
 * Progressive onboarding tour overlay with step-by-step guidance.
 * Features smooth animations, keyboard navigation, and responsive positioning.
 */
export function TourOverlay({ 
  steps, 
  currentStep, 
  onNext, 
  onPrevious, 
  onClose,
  className 
}: TourOverlayProps) {
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, height: 0 });

  const currentTourStep = steps[currentStep];

  // Find and position the target element
  useEffect(() => {
    if (!currentTourStep) return;

    const element = document.querySelector(currentTourStep.target) as HTMLElement;
    if (element) {
      setTargetElement(element);
      const rect = element.getBoundingClientRect();
      setPosition({
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [currentStep, currentTourStep]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && currentStep < steps.length - 1) onNext();
      if (e.key === "ArrowLeft" && currentStep > 0) onPrevious();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentStep, steps.length, onNext, onPrevious, onClose]);

  if (!currentTourStep || !targetElement) return null;

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-300" />
      
      {/* Highlight spotlight */}
      <div
        className="fixed z-40 pointer-events-none animate-in zoom-in duration-300"
        style={{
          top: position.top - 4,
          left: position.left - 4,
          width: position.width + 8,
          height: position.height + 8,
          boxShadow: "0 0 0 4px rgba(251, 191, 36, 0.5), 0 0 0 8px rgba(251, 191, 36, 0.3)",
          borderRadius: "12px",
        }}
      />

      {/* Tour card */}
      <div
        className={cn(
          "fixed z-50 w-80 rounded-2xl border border-amber-400/30 bg-[#0E1626] p-5 shadow-2xl animate-in slide-in-from-bottom-4 duration-300",
          className
        )}
        style={{
          top: position.top + position.height + 16,
          left: Math.max(16, Math.min(position.left, window.innerWidth - 336)),
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-amber-400/20 text-amber-300">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{currentTourStep.title}</h3>
              <p className="text-[10px] text-slate-400">
                مرحله {currentStep + 1} از {steps.length}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-300 leading-relaxed mb-4">
          {currentTourStep.description}
        </p>

        {/* Progress bar */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10 mb-4">
          <div
            className="h-full bg-amber-400 transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={onPrevious}
            disabled={isFirstStep}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors",
              isFirstStep
                ? "text-slate-500 cursor-not-allowed"
                : "text-slate-300 hover:bg-white/10"
            )}
          >
            <ChevronRight className="size-4" />
            قبلی
          </button>

          <div className="flex gap-1">
            {steps.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  if (index < currentStep) {
                    for (let i = 0; i < currentStep - index; i++) onPrevious();
                  } else if (index > currentStep) {
                    for (let i = 0; i < index - currentStep; i++) onNext();
                  }
                }}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  index === currentStep
                    ? "bg-amber-400"
                    : index < currentStep
                    ? "bg-slate-500"
                    : "bg-slate-700"
                )}
              />
            ))}
          </div>

          <button
            onClick={isLastStep ? onClose : onNext}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors",
              isLastStep
                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                : "bg-amber-400/20 text-amber-300 hover:bg-amber-400/30"
            )}
          >
            {isLastStep ? "پایان" : "بعدی"}
            {!isLastStep && <ChevronLeft className="size-4" />}
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="mt-3 pt-3 border-t border-white/10 text-center text-[10px] text-slate-500">
          برای پیمایش از کلیدهای جهت‌نما استفاده کنید • Esc برای خروج
        </div>
      </div>
    </>
  );
}