import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { OrgSwitcher } from "@/components/org-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { requireOrg } from "@/lib/tenant";
import { APP_NAME } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const org = await requireOrg(); // redirects to /sign-in when there is no session
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 space-y-4 border-e border-border p-4">
        <Link href="/dashboard" className="block font-semibold">
          {APP_NAME}
        </Link>
        <OrgSwitcher activeId={org.organizationId} />
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/dashboard" className="rounded px-2 py-1 hover:bg-muted">
            Dashboard
          </Link>
          <Link href="/dashboard/settings" className="rounded px-2 py-1 hover:bg-muted">
            Settings
          </Link>
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex h-14 items-center justify-end gap-3 border-b border-border px-6 text-sm">
          <span className="text-muted-foreground">{org.userEmail}</span>
          <LanguageSwitcher />
          <SignOutButton />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
