import Link from "next/link";
import { AppWindow } from "lucide-react";

/** Link from the roxira.ir module pages to the logged-in suite at /app. */
export function AppEntryLink({ href = "/app" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
    >
      <AppWindow className="size-4" aria-hidden="true" />
      ورود به نرم‌افزار
    </Link>
  );
}
