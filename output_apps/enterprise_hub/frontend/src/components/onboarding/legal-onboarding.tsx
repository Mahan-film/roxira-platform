"use client";

import React, { useState, useEffect } from "react";
import { TourOverlay } from "./tour-overlay";
import { HelpTooltip } from "./help-tooltip";
import { useAuth } from "@/components/auth/auth-provider";

/**
 * Progressive onboarding system for Ghazi Houshmand legal workspace.
 * Features contextual tooltips, guided tours, and smart user education.
 */
export function LegalOnboarding() {
  const { isAuthenticated } = useAuth();
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [hasSeenTour, setHasSeenTour] = useState(false);

  // Check if user has seen the tour before
  useEffect(() => {
    const seenTour = localStorage.getItem("ghazi_onboarding_seen");
    if (seenTour) {
      setHasSeenTour(true);
    } else {
      // Show tour after a short delay for first-time users
      const timer = setTimeout(() => {
        setShowTour(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Mark tour as seen when completed
  const handleTourComplete = () => {
    setShowTour(false);
    setHasSeenTour(true);
    localStorage.setItem("ghazi_onboarding_seen", "true");
  };

  const tourSteps = [
    {
      target: ".case-input",
      title: "ورود شرح پرونده",
      description: "شرح پرونده خود را تایپ کنید یا فایل‌های حقوقی (Word، PDF، تصاویر) را مستقیماً بارگذاری کنید. سیستم هوشمند متن را تحلیل و لایحه تنظیم می‌کند.",
      position: "top" as const,
    },
    {
      target: ".quick-actions",
      title: "اقدامات سریع",
      description: "دسترسی فوری به محاسبه خسارت تاخیر تادیه، اعاده دادرسی، تحلیل دادخواست و تنظیم لایحه تخصصی.",
      position: "bottom" as const,
    },
    {
      target: ".legal-output",
      title: "خروجی حقوقی",
      description: "مشاهده لایحه تنظیمی، مواد قانونی استنادی، آرای وحدت رویه و شانس موفقیت پرونده. روی مستندات کلیک کنید تا جزئیات را ببینید.",
      position: "left" as const,
    },
    {
      target: ".chat-history",
      title: "تاریخچه گفتگوها",
      description: "دسترسی به گفتگوهای قبلی، مدیریت پرونده‌ها و ادامه کار روی لایحه‌های ذخیره شده.",
      position: "right" as const,
    },
    {
      target: ".voice-input",
      title: "ورود صوتی",
      description: "شرح پرونده را به صورت صوتی بیان کنید. سیستم گفتار را به متن تبدیل و تحلیل حقوقی انجام می‌دهد.",
      position: "top" as const,
    },
  ];

  // Contextual help tooltips
  const helpTooltips = [
    {
      target: ".case-input",
      content: "میتوانید فایل‌های Word، PDF یا تصاویر اسناد را مستقیماً با دکمه پیوست بارگذاری کنید. سیستم OCR متون اسکن‌شده را هم خواندن می‌کند.",
      position: "top" as const,
    },
    {
      target: ".legal-output",
      content: "روی مواد قانونی و آرای وحدت رویه کلیک کنید تا تحلیل کاربردی و جزئیات بیشتری ببینید. لایحه قابل دانلود و چاپ است.",
      position: "left" as const,
    },
  ];

  // Show tour button for users who want to restart the tour
  const showTourButton = hasSeenTour && isAuthenticated;

  return (
    <>
      {/* Guided tour overlay */}
      {showTour && (
        <TourOverlay
          steps={tourSteps}
          currentStep={tourStep}
          onNext={() => setTourStep((s) => Math.min(s + 1, tourSteps.length - 1))}
          onPrevious={() => setTourStep((s) => Math.max(s - 1, 0))}
          onClose={handleTourComplete}
        />
      )}

      {/* Contextual help tooltips */}
      {helpTooltips.map((tooltip, index) => (
        <HelpTooltip
          key={index}
          target={tooltip.target}
          content={tooltip.content}
          position={tooltip.position}
        />
      ))}

      {/* Tour restart button */}
      {showTourButton && (
        <button
          onClick={() => {
            setTourStep(0);
            setShowTour(true);
          }}
          className="fixed bottom-4 left-4 z-40 flex items-center gap-2 px-4 py-2 bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/30 rounded-xl text-xs font-medium text-amber-300 transition-colors"
        >
          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          راهنمای سامانه
        </button>
      )}
    </>
  );
}