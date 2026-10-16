import Link from "next/link";

const tabs = [
  { href: "/dashboard/settings", label: "Profile" },
  { href: "/dashboard/settings/team", label: "Team" },
  { href: "/dashboard/settings/api-keys", label: "API keys" },
  { href: "/dashboard/settings/billing", label: "Billing" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <nav className="flex gap-4 border-b border-border pb-2 text-sm">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="hover:underline">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
