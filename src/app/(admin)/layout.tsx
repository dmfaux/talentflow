import Link from "next/link";
import { AdminSidebar } from "@/components/admin/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-cream font-sans">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/80 px-6 backdrop-blur-sm">
        <Link href="/clients" className="flex items-baseline gap-2">
          <span className="font-serif text-xl italic text-charcoal">
            TalentStream
          </span>
          <span className="text-[0.6rem] font-medium uppercase tracking-[0.2em] text-txt-muted">
            Admin
          </span>
        </Link>
        <div className="flex items-center gap-2 text-xs text-txt-secondary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green" />
          <span className="font-mono">System online</span>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <AdminSidebar />

        {/* Main content */}
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
