"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Campaigns", href: "/campaigns", icon: "campaign" },
  { label: "Clients", href: "/clients", icon: "client" },
  { label: "Users", href: "/users", icon: "users" },
  { label: "Settings", href: "/settings", icon: "settings" },
] as const;

const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="3" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="7" width="5" height="7" rx="1" />
    </svg>
  ),
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
  users: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="11.25" cy="6.5" r="1.75" />
      <path d="M2 13c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5" />
      <path d="M10.5 13c0-1.7 1-2.8 2.5-2.8s1.5 1.1 1.5 2.8" />
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
    <aside className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-52 flex-col border-r border-cobalt-deep/30 bg-cobalt">
      <nav className="flex-1 px-3 pt-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8rem] font-medium transition-colors ${
                    active
                      ? "bg-ink text-paper shadow-[0_4px_12px_-4px_rgba(11,15,28,0.35)]"
                      : "text-ink/65 hover:bg-ink/10 hover:text-ink"
                  }`}
                >
                  <span className={active ? "text-paper/80" : "text-ink/50"}>
                    {ICONS[item.icon]}
                  </span>
                  {item.label}
                  {active && (
                    <span className="absolute right-3 w-1 h-1 rounded-full bg-vermillion" aria-hidden />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-ink/15 p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8rem] font-medium text-ink/55 transition-colors hover:bg-vermillion hover:text-paper cursor-pointer"
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
