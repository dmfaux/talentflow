"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { label: "Campaigns", href: "/campaigns", icon: "campaign" },
  { label: "Clients", href: "/clients", icon: "client" },
  { label: "Settings", href: "/settings", icon: "settings" },
] as const;

const ICONS: Record<string, React.ReactNode> = {
  campaign: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M5 7h6M5 9.5h4" />
    </svg>
  ),
  client: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.75 3.75l1.5 1.5M10.75 10.75l1.5 1.5M3.75 12.25l1.5-1.5M10.75 5.25l1.5-1.5" />
    </svg>
  ),
};

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-52 flex-col border-r border-border bg-surface">
      <nav className="flex-1 px-3 pt-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8rem] font-medium transition-colors ${
                    active
                      ? "bg-charcoal text-cream"
                      : "text-txt-secondary hover:bg-cream hover:text-charcoal"
                  }`}
                >
                  <span className={active ? "text-gold" : "text-txt-muted"}>
                    {ICONS[item.icon]}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8rem] font-medium text-txt-muted transition-colors hover:bg-red-light hover:text-red cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2H4a2 2 0 00-2 2v8a2 2 0 002 2h2M10.5 11.5L14 8l-3.5-3.5M14 8H6" />
          </svg>
          Log out
        </button>
      </div>
    </aside>
  );
}
