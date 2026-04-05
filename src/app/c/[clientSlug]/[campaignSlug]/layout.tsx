export default function CampaignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f3f0e8" }} className="antialiased">
      {children}
    </div>
  );
}
