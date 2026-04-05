export default function TemplatePreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f3f0e8" }}>
      {children}
    </div>
  );
}
