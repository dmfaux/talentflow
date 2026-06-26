import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBrandLanding } from "@/lib/brand-landing";
import { BrandLanding } from "@/components/candidate/BrandLanding";

interface Props {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** First value of a possibly-repeated query param, trimmed to non-empty. */
function one(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.trim() ? v.trim() : null;
}

function pageNum(value: string | string[] | undefined): number {
  const n = Number.parseInt(one(value) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function load({ params, searchParams }: Props) {
  const { clientSlug } = await params;
  const sp = await searchParams;
  return getBrandLanding(
    clientSlug,
    pageNum(sp.page),
    one(sp.dept),
    one(sp.loc),
    one(sp.type),
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const data = await load({ params, searchParams });

  if (data.kind === "not_found") return { title: "Careers — Not found" };
  if (data.kind === "org_unavailable")
    return { title: "Careers — Not available" };

  const { brand, totalOpen } = data;
  return {
    title: `Careers at ${brand.name}`,
    description:
      totalOpen > 0
        ? `${totalOpen} open ${totalOpen === 1 ? "role" : "roles"} at ${brand.name}. Explore the positions and apply.`
        : `Open roles at ${brand.name}.`,
    openGraph: { title: `Careers at ${brand.name}`, type: "website" },
  };
}

export default async function BrandLandingPage({ params, searchParams }: Props) {
  const data = await load({ params, searchParams });

  if (data.kind === "not_found") notFound();

  // Suspended/deleted org → freeze the careers page with a generic surface that
  // leaks no org state (mirrors the per-campaign apply page).
  if (data.kind === "org_unavailable") {
    return (
      <Unavailable
        title="This organisation isn't accepting applications"
        message="Open roles aren't available right now. If you believe this is an error, please contact the employer directly."
      />
    );
  }

  return <BrandLanding data={data} />;
}

function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-border">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="#999999"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6.5v4M10 13.5v.01" />
          </svg>
        </div>
        <h1 className="font-serif text-xl italic text-charcoal">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-txt-secondary">{message}</p>
      </div>
    </main>
  );
}
