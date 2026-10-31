import type { Metadata } from "next";

import { PortalAuthEntry } from "@/components/auth/portal-auth-entry";

export const metadata: Metadata = {
  title: "ورود به روکسیرا",
  robots: { index: false },
};

export default function LoginPage() {
  return <PortalAuthEntry mode="login" />;
}
