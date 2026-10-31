import type { Metadata } from "next";

import { PortalAuthEntry } from "@/components/auth/portal-auth-entry";

export const metadata: Metadata = {
  title: "ثبت‌نام در روکسیرا",
  robots: { index: false },
};

export default function SignupPage() {
  return <PortalAuthEntry mode="signup" />;
}
