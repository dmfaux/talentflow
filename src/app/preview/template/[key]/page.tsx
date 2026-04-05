import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTemplate } from "@/templates/registry";
import type { GatingQuestion } from "@/lib/gating";
import type {
  LogoBackground,
  LogoPosition,
  TemplateClient,
  TemplateCampaign,
} from "@/templates/types";

interface Props {
  params: Promise<{ key: string }>;
  searchParams: Promise<{
    clientId?: string;
    roleTitle?: string;
    roleDescription?: string;
    department?: string;
    location?: string;
    employmentType?: string;
    salaryMin?: string;
    salaryMax?: string;
    gating?: string;
  }>;
}

function PreviewError({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
        color: "#0b0f1c",
      }}
    >
      <p>{message}</p>
    </div>
  );
}

export default async function TemplatePreview({
  params,
  searchParams,
}: Props) {
  const { key } = await params;
  const sp = await searchParams;

  const TemplateComponent = getTemplate(key);
  if (!TemplateComponent) {
    return <PreviewError message={`Template not found: ${key}`} />;
  }

  if (!sp.clientId) {
    return <PreviewError message="clientId is required" />;
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, sp.clientId),
  });

  if (!client) {
    return <PreviewError message="Client not found" />;
  }

  let gating: GatingQuestion[] = [];
  try {
    const parsed = JSON.parse(sp.gating ?? "[]");
    if (Array.isArray(parsed)) gating = parsed as GatingQuestion[];
  } catch {
    gating = [];
  }

  const clientProps: TemplateClient = {
    slug: client.slug,
    name: client.name,
    logo_url: client.branding_logo_url,
    logo_background: (client.logo_background ?? "light") as LogoBackground,
    logo_position: (client.logo_position ?? "top-left") as LogoPosition,
    brand_primary_color: client.brand_primary_color ?? "#0b0f1c",
    brand_secondary_color: client.brand_secondary_color ?? "#f3f0e8",
    brand_accent_color: client.brand_accent_color,
    brand_text_color: client.brand_text_color ?? "#0b0f1c",
  };

  const campaignProps: TemplateCampaign = {
    slug: "preview",
    role_title: sp.roleTitle || "Sample Role",
    role_description: sp.roleDescription || null,
    department: sp.department || null,
    location: sp.location || null,
    employment_type: sp.employmentType || null,
    salary_range_min: sp.salaryMin ? parseInt(sp.salaryMin, 10) : null,
    salary_range_max: sp.salaryMax ? parseInt(sp.salaryMax, 10) : null,
    gating_config: gating,
  };

  // eslint-disable-next-line react-hooks/static-components
  return <TemplateComponent client={clientProps} campaign={campaignProps} />;
}
