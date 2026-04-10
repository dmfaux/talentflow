import Link from "next/link";
import { AdminSidebar } from "@/components/admin/sidebar";
import { ActiveCampaignCount } from "@/components/admin/active-campaign-count";
import { ToastProvider } from "@/components/ui/toast-provider";
import { Logo } from "@/components/brand/logo";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas font-sans">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-rule bg-paper/85 px-6 backdrop-blur-md">
        <Link href="/dashboard" className="group" aria-label="TalentStream admin">
          <Logo size="md" eyebrow="Admin" />
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
