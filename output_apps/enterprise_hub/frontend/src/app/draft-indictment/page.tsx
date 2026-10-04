import type { Metadata } from "next";
import { DraftIndictmentClient } from "@/components/draft-indictment/draft-indictment-client";

const TITLE = "پیش‌نویس غیررسمی کیفرخواست | قاضی هوشمند";
const DESCRIPTION =
  "تهیه پیش‌نویس غیررسمی و غیرقطعی کیفرخواست با استناد به مواد قانونی تأییدشده؛ ویژه مشترکین VIP.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/draft-indictment" },
  robots: { index: false, follow: true },
};

export default function DraftIndictmentPage() {
  return <DraftIndictmentClient />;
}
