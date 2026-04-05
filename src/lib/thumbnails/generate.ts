// ── Template thumbnail generator ──────────────────────────────────
//
// Renders a custom template's block tree via Satori into an SVG
// thumbnail suitable for the admin template gallery. Uses bundled
// Inter (sans) + Noto Serif (serif) fonts at 400/600 weights.
//
// Output: raw SVG as a Buffer (UTF-8). Saved as .svg to blob storage —
// the browser renders SVG natively so no PNG conversion is needed.

import { readFileSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { BlockTreeRenderer, THUMBNAIL_FONT_MAP } from "@/templates/blocks/renderer";
import type { BlockTree } from "@/templates/blocks/schema";
import type { TemplateCampaign, TemplateClient } from "@/templates/types";

const THUMBNAIL_WIDTH = 800;
const THUMBNAIL_HEIGHT = 1200;

// ── Font loading (lazy, once per process) ──────────────────────────

interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600;
  style: "normal";
}

let cachedFonts: LoadedFont[] | null = null;

// Runtime-constructed paths — opaque to webpack's static analysis,
// so the font files aren't pulled into the server bundle. We read
// them from node_modules at runtime.
const NODE_MODULES = path.join(process.cwd(), "node_modules");

function readFont(relPath: string): ArrayBuffer {
  const buf = readFileSync(path.join(NODE_MODULES, relPath));
  // Satori requires ArrayBuffer, not Node Buffer. Slice to a tight
  // ArrayBuffer so we don't expose the underlying pool memory.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function loadFonts(): LoadedFont[] {
  if (cachedFonts) return cachedFonts;
  cachedFonts = [
    {
      name: "Inter",
      weight: 400,
      style: "normal",
      data: readFont("@fontsource/inter/files/inter-latin-400-normal.woff"),
    },
    {
      name: "Inter",
      weight: 600,
      style: "normal",
      data: readFont("@fontsource/inter/files/inter-latin-600-normal.woff"),
    },
    {
      name: "Noto Serif",
      weight: 400,
      style: "normal",
      data: readFont(
        "@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff"
      ),
    },
    {
      name: "Noto Serif",
      weight: 600,
      style: "normal",
      data: readFont(
        "@fontsource/noto-serif/files/noto-serif-latin-600-normal.woff"
      ),
    },
  ];
  return cachedFonts;
}

// ── Demo data ───────────────────────────────────────────────────────

export const DEFAULT_DEMO_CAMPAIGN: TemplateCampaign = {
  slug: "senior-engineer",
  role_title: "Senior Engineer",
  role_description:
    "Join a small team building tools that thousands of people rely on every day. You'll own features end-to-end, pair often, and ship to production daily.",
  department: "Engineering",
  location: "Cape Town",
  employment_type: "Full-time",
  salary_range_min: 850_000,
  salary_range_max: 1_150_000,
  gating_config: [],
};

export const DEFAULT_DEMO_CLIENT: TemplateClient = {
  slug: "acme-co",
  name: "Acme Co.",
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "#0b3a82",
  brand_secondary_color: "#f5f7fb",
  brand_accent_color: "#f0a500",
  brand_text_color: "#0b0f1c",
};

// ── Generator ───────────────────────────────────────────────────────

export interface GenerateThumbnailOptions {
  tree: BlockTree;
  /**
   * If the template is bespoke to a client, render with their brand
   * palette. Otherwise the generic demo palette is used.
   */
  client?: TemplateClient;
  campaign?: TemplateCampaign;
}

export async function generateThumbnailSvg(
  options: GenerateThumbnailOptions
): Promise<Buffer> {
  const { tree } = options;
  const client = options.client ?? DEFAULT_DEMO_CLIENT;
  const campaign = options.campaign ?? DEFAULT_DEMO_CAMPAIGN;
  const fonts = loadFonts();

  const element = BlockTreeRenderer({
    tree,
    client,
    campaign,
    fontMap: THUMBNAIL_FONT_MAP,
    previewMode: true,
  });

  const svg = await satori(element as React.ReactElement, {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });

  return Buffer.from(svg, "utf-8");
}
