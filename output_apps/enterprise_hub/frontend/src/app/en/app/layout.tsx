import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Roxira account",
  description: "Your Roxira International account and organization.",
  // Signed-in area: never index or cache.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function EnglishPanelLayout({ children }: { children: ReactNode }) {
  return children;
}
