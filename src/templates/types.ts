import type { GatingQuestion } from "@/lib/gating";

export type LogoBackground = "light" | "dark" | "transparent";
export type LogoPosition = "top-left" | "top-centre";

export interface TemplateClient {
  slug: string;
  name: string;
  logo_url: string | null;
  logo_background: LogoBackground;
  logo_position: LogoPosition;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_accent_color: string | null;
  brand_text_color: string;
}

export interface TemplateCampaign {
  slug: string;
  role_title: string;
  role_description: string | null;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  salary_range_min: number | null;
  salary_range_max: number | null;
  gating_config: GatingQuestion[];
}

export interface TemplateProps {
  client: TemplateClient;
  campaign: TemplateCampaign;
}

export type TemplateComponent = React.FC<TemplateProps>;
