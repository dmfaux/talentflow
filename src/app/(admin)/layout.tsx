import Link from "next/link";
import { AdminSidebar } from "@/components/admin/sidebar";
import { ActiveCampaignCount } from "@/components/admin/active-campaign-count";
import { ToastProvider } from "@/components/ui/toast-provider";

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
        <ActiveCampaignCount />
      </header>

      <div className="flex">
        {/* Sidebar */}
        <AdminSidebar />

        {/* Main content */}
        <main className="flex-1 px-8 py-6">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}
