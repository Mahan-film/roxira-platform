import Link from "next/link";
import { APP_NAME } from "@/lib/utils";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <Link href="/" className="mb-6 text-lg font-semibold">
        {APP_NAME}
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
