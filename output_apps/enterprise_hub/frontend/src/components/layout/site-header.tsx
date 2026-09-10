import Link from "next/link";
import { Building2 } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "داشبورد" },
  { href: "/damages", label: "تاریخچه محاسبات" },
  { href: "/invoicing", label: "فاکتورها" },
];

export function SiteHeader() {
  return (
    <header className="border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Building2 className="size-5 text-primary" />
          <span>پورتال خدمات سازمانی روکسیرا</span>
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
          <a
            href="/docs"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            مستندات API
          </a>
        </nav>
      </div>
    </header>
  );
}
