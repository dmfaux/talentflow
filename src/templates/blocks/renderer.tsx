// ── Block-tree renderer for custom templates ───────────────────────
//
// Walks a validated BlockTree and produces React output. Used by:
//   - src/app/c/[clientSlug]/[campaignSlug]/page.tsx (production)
//   - future editor iframe preview
//
// Renders the fixed <ApplicationForm /> at the single form_slot block.
// The form's POST endpoint is NOT template-controllable — it's hardwired
// in ApplicationForm itself (currently /api/public/applications).

import { ApplicationForm } from "@/components/candidate/ApplicationForm";
import type { TemplateProps } from "../types";
import type {
  Block,
  BlockTree,
  ColorRef,
  ContainerBlock,
  DividerBlock,
  EyebrowBlock,
  FooterBlock,
  FormSlotBlock,
  HeadingBlock,
  LogoHeaderBlock,
  MetaStripBlock,
  RichTextBlock,
  RootBlock,
  SalaryBadgeBlock,
  SpacerBlock,
  TextBinding,
  Typography,
} from "./schema";
import {
  firstInitial,
  formatSalary,
  initialCircleStyle,
  logoImageStyle,
  logoWrapperStyle,
} from "../library/_shared";

// ── Props ────────────────────────────────────────────────────────────

interface BlockTreeRendererProps extends TemplateProps {
  tree: BlockTree;
  /**
   * Override the font-family resolution. Defaults to DEFAULT_FONT_MAP
   * (CSS custom properties). Pass THUMBNAIL_FONT_MAP for Satori.
   */
  fontMap?: FontMap;
  /**
   * When true, substitute the interactive ApplicationForm with a
   * static placeholder card. Used by the thumbnail generator (which
   * can't render client components) and by the editor iframe.
   */
  previewMode?: boolean;
}

// ── Token resolvers ─────────────────────────────────────────────────

type BrandPalette = {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
};

function resolveBrandPalette(
  client: TemplateProps["client"]
): BrandPalette {
  const primary = client.brand_primary_color || "#0b0f1c";
  return {
    primary,
    secondary: client.brand_secondary_color || "#f3f0e8",
    accent: client.brand_accent_color || primary,
    text: client.brand_text_color || "#0b0f1c",
  };
}

function resolveColor(ref: ColorRef, palette: BrandPalette): string {
  if (ref.kind === "hex") return ref.value;
  return palette[ref.token];
}

export type FontMap = Record<Typography["family"], string>;

/**
 * Default font-family map used in production — references the CSS
 * custom properties set by the Next.js root layout.
 */
export const DEFAULT_FONT_MAP: FontMap = {
  serif: "var(--font-fraunces), Georgia, serif",
  sans: "var(--font-instrument-sans), -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "var(--font-jetbrains-mono), monospace",
  system: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
};

/**
 * Font map for Satori-based thumbnail generation. Satori cannot
 * resolve CSS custom properties; bundled serif/sans WOFF fonts are
 * registered at these exact names.
 */
export const THUMBNAIL_FONT_MAP: FontMap = {
  serif: "Noto Serif",
  sans: "Inter",
  mono: "Inter",
  system: "Inter",
};

interface RenderCtx {
  palette: BrandPalette;
  props: TemplateProps;
  fontMap: FontMap;
  previewMode: boolean;
}

function typographyToStyle(t: Typography, ctx: RenderCtx): React.CSSProperties {
  return {
    fontFamily: ctx.fontMap[t.family],
    fontWeight: t.weight,
    fontSize: `${t.size}rem`,
    fontStyle: t.italic ? "italic" : "normal",
    lineHeight: t.lineHeight,
    letterSpacing: `${t.letterSpacing}em`,
    textTransform: t.uppercase ? "uppercase" : "none",
    color: resolveColor(t.color, ctx.palette),
    margin: 0,
  };
}

// ── Binding resolver ────────────────────────────────────────────────

function resolveBinding(
  binding: TextBinding,
  props: TemplateProps
): string | null {
  if (binding.kind === "static") return binding.value;
  const [domain, field] = binding.field.split(".") as [
    "client" | "campaign",
    string,
  ];
  const source =
    domain === "client"
      ? (props.client as unknown as Record<string, unknown>)
      : (props.campaign as unknown as Record<string, unknown>);
  const value = source[field];
  if (value === null || value === undefined) return null;
  return String(value);
}

function metaValue(
  field: "campaign.department" | "campaign.location" | "campaign.employment_type",
  props: TemplateProps
): string | null {
  const key = field.split(".")[1] as keyof TemplateProps["campaign"];
  const v = props.campaign[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

// ── Align → CSS ─────────────────────────────────────────────────────

function alignToJustify(align: "left" | "center" | "right"): React.CSSProperties {
  return {
    display: "flex",
    justifyContent:
      align === "center"
        ? "center"
        : align === "right"
          ? "flex-end"
          : "flex-start",
  };
}

function alignToTextAlign(align: "left" | "center" | "right"): React.CSSProperties {
  return { textAlign: align };
}

// ── Block renderers ─────────────────────────────────────────────────

function RenderBlock({ block, ctx }: { block: Block; ctx: RenderCtx }) {
  switch (block.type) {
    case "root":
      return <RenderRoot block={block} ctx={ctx} />;
    case "container":
      return <RenderContainer block={block} ctx={ctx} />;
    case "logo_header":
      return <RenderLogoHeader block={block} ctx={ctx} />;
    case "heading":
      return <RenderHeading block={block} ctx={ctx} />;
    case "eyebrow":
      return <RenderEyebrow block={block} ctx={ctx} />;
    case "meta_strip":
      return <RenderMetaStrip block={block} ctx={ctx} />;
    case "salary_badge":
      return <RenderSalaryBadge block={block} ctx={ctx} />;
    case "rich_text":
      return <RenderRichText block={block} ctx={ctx} />;
    case "form_slot":
      return <RenderFormSlot block={block} ctx={ctx} />;
    case "divider":
      return <RenderDivider block={block} ctx={ctx} />;
    case "spacer":
      return <RenderSpacer block={block} />;
    case "footer":
      return <RenderFooter block={block} ctx={ctx} />;
  }
}

function RenderRoot({ block, ctx }: { block: RootBlock; ctx: RenderCtx }) {
  const bgColor =
    block.bg.kind === "color"
      ? resolveColor(block.bg.color, ctx.palette)
      : undefined;
  return (
    <div
      style={{
        // In previewMode (Satori), omit minHeight entirely and let
        // the fixed-width container drive height.
        ...(ctx.previewMode ? {} : { minHeight: "100vh" }),
        backgroundColor: bgColor,
        color: ctx.palette.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {block.children.map((child) => (
        <RenderBlock key={child.id} block={child} ctx={ctx} />
      ))}
    </div>
  );
}

function RenderContainer({
  block,
  ctx,
}: {
  block: ContainerBlock;
  ctx: RenderCtx;
}) {
  const margin =
    block.align === "center"
      ? "0 auto"
      : block.align === "right"
        ? "0 0 0 auto"
        : "0";
  return (
    <div
      style={{
        maxWidth: `${block.maxWidth}px`,
        margin,
        paddingTop: `${block.padding.top}rem`,
        paddingRight: `${block.padding.right}rem`,
        paddingBottom: `${block.padding.bottom}rem`,
        paddingLeft: `${block.padding.left}rem`,
        display: "flex",
        flexDirection: "column",
        width: "100%",
      }}
    >
      {block.children.map((child) => (
        <RenderBlock key={child.id} block={child} ctx={ctx} />
      ))}
    </div>
  );
}

function RenderLogoHeader({
  block,
  ctx,
}: {
  block: LogoHeaderBlock;
  ctx: RenderCtx;
}) {
  const { client } = ctx.props;
  const maxWidth = Math.round(block.logoHeight * 4.5);
  // Satori can't load remote images reliably during SSR — skip the
  // logo image in preview mode and fall back to the initial circle.
  const showImage = !ctx.previewMode && !!client.logo_url;
  return (
    <header style={{ ...alignToJustify(block.align), marginBottom: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        {showImage ? (
          <span
            style={{
              ...logoWrapperStyle(
                client.logo_background,
                block.logoHeight,
                maxWidth
              ),
              display: "flex", // Satori doesn't support inline-flex
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={client.logo_url!}
              alt={`${client.name} logo`}
              style={logoImageStyle()}
            />
          </span>
        ) : (
          <span
            style={{
              ...initialCircleStyle(ctx.palette.primary, block.logoHeight),
              display: "flex",
            }}
          >
            {firstInitial(client.name)}
          </span>
        )}
        {block.showClientName && (
          <span style={typographyToStyle(block.clientNameTypography, ctx)}>
            {client.name}
          </span>
        )}
      </div>
    </header>
  );
}

function RenderHeading({
  block,
  ctx,
}: {
  block: HeadingBlock;
  ctx: RenderCtx;
}) {
  const text = resolveBinding(block.text, ctx.props);
  if (!text) return null;
  const style: React.CSSProperties = {
    ...typographyToStyle(block.typography, ctx),
    ...alignToTextAlign(block.align),
    marginBottom: "1rem",
  };
  if (block.maxWidth != null) {
    style.maxWidth = `${block.maxWidth}px`;
    if (block.align === "center") {
      style.marginLeft = "auto";
      style.marginRight = "auto";
    }
  }
  if (block.level === 1) return <h1 style={style}>{text}</h1>;
  if (block.level === 2) return <h2 style={style}>{text}</h2>;
  return <h3 style={style}>{text}</h3>;
}

function RenderEyebrow({
  block,
  ctx,
}: {
  block: EyebrowBlock;
  ctx: RenderCtx;
}) {
  const text = resolveBinding(block.text, ctx.props);
  if (!text) return null;
  return (
    <p
      style={{
        ...typographyToStyle(block.typography, ctx),
        ...alignToTextAlign(block.align),
        marginBottom: "0.75rem",
      }}
    >
      {text}
    </p>
  );
}

function RenderMetaStrip({
  block,
  ctx,
}: {
  block: MetaStripBlock;
  ctx: RenderCtx;
}) {
  const parts = block.fields
    .map((field) => metaValue(field, ctx.props))
    .filter((v): v is string => v !== null);
  if (parts.length === 0) return null;

  const baseStyle = typographyToStyle(block.typography, ctx);
  const justify =
    block.align === "center"
      ? "center"
      : block.align === "right"
        ? "flex-end"
        : "flex-start";

  if (block.style === "dots") {
    return (
      <div
        aria-label="Role details"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.375rem 0.875rem",
          justifyContent: justify,
          marginBottom: "1.5rem",
          ...baseStyle,
        }}
      >
        {parts.map((part, idx) => (
          <span
            key={part + idx}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.875rem",
            }}
          >
            <span>{part}</span>
            {idx < parts.length - 1 && (
              <span aria-hidden style={{ opacity: 0.45 }}>
                ·
              </span>
            )}
          </span>
        ))}
      </div>
    );
  }

  // pills or pills-outline
  const outline = block.style === "pills-outline";
  return (
    <div
      aria-label="Role details"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        justifyContent: justify,
        marginBottom: "1.5rem",
      }}
    >
      {parts.map((part) => (
        <span
          key={part}
          style={{
            ...baseStyle,
            padding: "0.375rem 0.875rem",
            borderRadius: "999px",
            border: outline ? "1px solid rgba(11, 15, 28, 0.16)" : "none",
            backgroundColor: outline
              ? "transparent"
              : "rgba(11, 15, 28, 0.05)",
          }}
        >
          {part}
        </span>
      ))}
    </div>
  );
}

function RenderSalaryBadge({
  block,
  ctx,
}: {
  block: SalaryBadgeBlock;
  ctx: RenderCtx;
}) {
  const salary = formatSalary(
    ctx.props.campaign.salary_range_min,
    ctx.props.campaign.salary_range_max
  );
  if (!salary) return null;
  const base = typographyToStyle(block.typography, ctx);
  const containerStyle: React.CSSProperties = {
    ...alignToJustify(block.align),
    marginBottom: "1.5rem",
  };
  const badgeStyle: React.CSSProperties = {
    ...base,
    display: "flex",
    padding:
      block.style === "plain" ? "0" : "0.375rem 0.75rem",
    borderRadius:
      block.style === "pill"
        ? "999px"
        : block.style === "chip"
          ? "0.375rem"
          : "0",
    backgroundColor:
      block.style === "plain" ? "transparent" : "rgba(11, 15, 28, 0.045)",
  };
  return (
    <div style={containerStyle}>
      <span style={badgeStyle}>{salary}</span>
    </div>
  );
}

function RenderRichText({
  block,
  ctx,
}: {
  block: RichTextBlock;
  ctx: RenderCtx;
}) {
  const raw = resolveBinding(block.text, ctx.props);
  const text = raw && raw.trim().length > 0 ? raw : null;
  const style: React.CSSProperties = {
    ...typographyToStyle(block.typography, ctx),
    ...alignToTextAlign(block.align),
    whiteSpace: "pre-wrap",
    marginBottom: "2rem",
    fontStyle: text ? block.typography.italic ? "italic" : "normal" : "italic",
    opacity: text ? 1 : 0.55,
  };
  if (block.maxWidth != null) {
    style.maxWidth = `${block.maxWidth}px`;
    if (block.align === "center") {
      style.marginLeft = "auto";
      style.marginRight = "auto";
    }
  }
  return <p style={style}>{text ?? block.emptyFallback}</p>;
}

function RenderFormSlot({
  block,
  ctx,
}: {
  block: FormSlotBlock;
  ctx: RenderCtx;
}) {
  const cardStyles: Record<FormSlotBlock["cardStyle"], React.CSSProperties> = {
    plain: {},
    bordered: {
      backgroundColor: "#ffffff",
      border: "1px solid rgba(0, 0, 0, 0.08)",
      borderRadius: "0.75rem",
      padding: "2rem",
    },
    shadowed: {
      backgroundColor: "#ffffff",
      border: "1px solid rgba(0, 0, 0, 0.08)",
      borderRadius: "0.75rem",
      padding: "2.5rem",
      boxShadow: "0 12px 32px -16px rgba(11, 15, 28, 0.08)",
    },
  };
  return (
    <section
      style={{
        ...cardStyles[block.cardStyle],
        display: "flex",
        flexDirection: "column",
      }}
    >
      {block.heading && (
        <h2
          style={{
            fontFamily: ctx.fontMap.serif,
            fontWeight: 500,
            fontSize: "1.625rem",
            color: ctx.palette.text,
            margin: "0 0 0.5rem",
          }}
        >
          {block.heading}
        </h2>
      )}
      {block.subheading && (
        <p
          style={{
            fontFamily: ctx.fontMap.sans,
            fontSize: "0.92rem",
            color: "rgba(11, 15, 28, 0.6)",
            margin: "0 0 1.5rem",
            lineHeight: 1.6,
          }}
        >
          {block.subheading}
        </p>
      )}
      {ctx.previewMode ? (
        <FormPlaceholder ctx={ctx} />
      ) : (
        <ApplicationForm
          clientSlug={ctx.props.client.slug}
          clientName={ctx.props.client.name}
          campaign={{
            slug: ctx.props.campaign.slug,
            role_title: ctx.props.campaign.role_title,
            gating_config: ctx.props.campaign.gating_config,
          }}
          brandColours={{
            primary: ctx.props.client.brand_primary_color,
            secondary: ctx.props.client.brand_secondary_color,
            accent: ctx.props.client.brand_accent_color,
            text: ctx.props.client.brand_text_color,
          }}
        />
      )}
    </section>
  );
}

// Satori-friendly stand-in for the form. Shows labelled placeholder
// rows + a submit-button bar so the overall shape reads as a form.
function FormPlaceholder({ ctx }: { ctx: RenderCtx }) {
  const labelStyle: React.CSSProperties = {
    fontFamily: ctx.fontMap.sans,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "rgba(11, 15, 28, 0.62)",
    letterSpacing: "0.02em",
    marginBottom: "0.375rem",
    display: "block",
  };
  const inputStyle: React.CSSProperties = {
    height: "2.25rem",
    borderRadius: "0.375rem",
    border: "1px solid rgba(11, 15, 28, 0.12)",
    backgroundColor: "rgba(11, 15, 28, 0.02)",
    display: "flex",
    marginBottom: "0.875rem",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={labelStyle}>Full name</span>
      <div style={inputStyle} />
      <span style={labelStyle}>Email</span>
      <div style={inputStyle} />
      <span style={labelStyle}>CV / resume</span>
      <div
        style={{
          height: "3rem",
          borderRadius: "0.375rem",
          border: "1px dashed rgba(11, 15, 28, 0.2)",
          backgroundColor: "rgba(11, 15, 28, 0.02)",
          display: "flex",
          marginBottom: "1rem",
        }}
      />
      <div
        style={{
          height: "2.5rem",
          borderRadius: "0.375rem",
          backgroundColor: ctx.palette.primary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontFamily: ctx.fontMap.sans,
          fontSize: "0.85rem",
          fontWeight: 600,
        }}
      >
        Submit application
      </div>
    </div>
  );
}

function RenderDivider({
  block,
  ctx,
}: {
  block: DividerBlock;
  ctx: RenderCtx;
}) {
  return (
    <div
      role="presentation"
      style={{
        height: `${block.thickness}px`,
        backgroundColor: resolveColor(block.color, ctx.palette),
        margin: `1.5rem ${block.inset}rem`,
      }}
    />
  );
}

function RenderSpacer({ block }: { block: SpacerBlock }) {
  return <div style={{ height: `${block.height}rem` }} />;
}

function RenderFooter({
  block,
  ctx,
}: {
  block: FooterBlock;
  ctx: RenderCtx;
}) {
  const suffix = block.showPoweredBy
    ? `${block.text ? " · " : ""}Powered by TalentStream`
    : "";
  return (
    <footer
      style={{
        ...typographyToStyle(block.typography, ctx),
        ...alignToTextAlign(block.align),
        paddingTop: "1.5rem",
        paddingBottom: "1.5rem",
        borderTop: "1px solid rgba(11, 15, 28, 0.08)",
        display: "flex",
        justifyContent:
          block.align === "center"
            ? "center"
            : block.align === "right"
              ? "flex-end"
              : "flex-start",
      }}
    >
      <span>
        {block.text}
        {suffix}
      </span>
    </footer>
  );
}

// ── Entry point ─────────────────────────────────────────────────────

export function BlockTreeRenderer({
  tree,
  client,
  campaign,
  fontMap = DEFAULT_FONT_MAP,
  previewMode = false,
}: BlockTreeRendererProps) {
  const palette = resolveBrandPalette(client);
  const ctx: RenderCtx = {
    palette,
    props: { client, campaign },
    fontMap,
    previewMode,
  };
  return <RenderBlock block={tree.root} ctx={ctx} />;
}
