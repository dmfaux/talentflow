export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="font-serif text-2xl italic text-charcoal">
          Campaign: {slug}
        </h1>
        <p className="mt-2 text-sm text-txt-muted">
          This page will render the campaign landing page.
        </p>
      </div>
    </div>
  );
}
