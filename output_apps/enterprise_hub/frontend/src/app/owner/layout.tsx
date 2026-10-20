import type { Metadata } from "next";
import type { ReactNode } from "react";

// The owner console must never be indexed or cached; access control is enforced by the API, not by this page.
export const metadata: Metadata = {
  title: "کنسول مدیریت | روکسیرا",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
