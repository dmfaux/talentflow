export default function CampaignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f0f3f7" }} className="antialiased">
      {children}
    </div>
  );
}
