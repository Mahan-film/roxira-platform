import Link from "next/link";
import { ScaleIcon } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "محاسبه‌گر" },
  { href: "/damages", label: "تاریخچه محاسبات" },
];

export function SiteHeader() {
  return (
    <header className="border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <ScaleIcon className="size-5 text-primary" />
          <span>Roxira Enterprise Hub</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
