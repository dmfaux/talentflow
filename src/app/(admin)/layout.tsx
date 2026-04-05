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
    <div className="min-h-screen bg-canvas font-sans">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-rule bg-paper/85 px-6 backdrop-blur-md">
        <Link href="/dashboard" className="flex items-center gap-2.5 group">
          <span className="relative w-1.5 h-1.5 rounded-full bg-vermillion pulse-dot" aria-hidden />
          <span className="font-display text-[1.15rem] text-ink tracking-[-0.02em] leading-none">
            Talent<span className="font-display-italic text-cobalt">Stream</span>
          </span>
          <span className="ml-1 eyebrow text-[0.58rem] text-ink-faint">
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
