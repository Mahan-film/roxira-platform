import type { Metadata } from "next";
import { DraftRulingClient } from "@/components/draft-ruling/draft-ruling-client";

const TITLE = "پیش‌نویس غیررسمی رأی | قاضی هوشمند";
const DESCRIPTION =
  "تهیه پیش‌نویس غیررسمی و غیرقطعی رأی با استناد به مواد قانونی تأییدشده؛ ویژه مشترکین VIP.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/draft-ruling" },
  robots: { index: false, follow: true },
};

export default function DraftRulingPage() {
  return <DraftRulingClient />;
}
