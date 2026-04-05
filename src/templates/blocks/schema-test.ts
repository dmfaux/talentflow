// Demo fixture + end-to-end render check. Invoke with:
//   npx tsx src/templates/blocks/schema-test.ts
//
// Constructs an editorial-lookalike custom template, validates it,
// and smoke-tests the React renderer by rendering to a static markup
// string. Not a replacement for visual regression — just confirms the
// renderer produces *some* markup without throwing.

import { renderToStaticMarkup } from "react-dom/server";
import { parseBlockTree } from "./schema";
import { BlockTreeRenderer } from "./renderer";
import type { TemplateClient, TemplateCampaign } from "../types";

const demoTree = {
  version: 1,
  root: {
    id: "root",
    type: "root",
    bg: { kind: "color", color: { kind: "hex", value: "#f3f0e8" } },
    children: [
      {
        id: "shell",
        type: "container",
        maxWidth: 720,
        padding: { top: 2.5, right: 1.25, bottom: 3, left: 1.25 },
        align: "center",
        children: [
          {
            id: "logo",
            type: "logo_header",
            logoHeight: 72,
            showClientName: true,
            align: "left",
            clientNameTypography: {
              family: "sans",
              weight: 600,
              size: 0.78,
              italic: false,
              lineHeight: 1.4,
              letterSpacing: 0.12,
              uppercase: true,
              color: { kind: "hex", value: "#58607a" },
            },
          },
          {
            id: "title",
            type: "heading",
            level: 1,
            text: { kind: "bind", field: "campaign.role_title" },
            typography: {
              family: "serif",
              weight: 400,
              size: 3.5,
              italic: true,
              lineHeight: 1.05,
              letterSpacing: -0.02,
              uppercase: false,
              color: { kind: "brand", token: "primary" },
            },
            align: "left",
            maxWidth: null,
          },
          {
            id: "meta",
            type: "meta_strip",
            style: "dots",
            fields: [
              "campaign.department",
              "campaign.location",
              "campaign.employment_type",
            ],
            typography: {
              family: "mono",
              weight: 500,
              size: 0.72,
              italic: false,
              lineHeight: 1.4,
              letterSpacing: 0.08,
              uppercase: true,
              color: { kind: "hex", value: "#58607a" },
            },
            align: "left",
          },
          {
            id: "salary",
            type: "salary_badge",
            style: "chip",
            typography: {
              family: "mono",
              weight: 500,
              size: 0.82,
              italic: false,
              lineHeight: 1.4,
              letterSpacing: 0,
              uppercase: false,
              color: { kind: "hex", value: "#0b0f1c" },
            },
            align: "left",
          },
          {
            id: "desc",
            type: "rich_text",
            text: { kind: "bind", field: "campaign.role_description" },
            emptyFallback: "Full role details will be shared with shortlisted candidates.",
            typography: {
              family: "sans",
              weight: 400,
              size: 1.05,
              italic: false,
              lineHeight: 1.75,
              letterSpacing: 0,
              uppercase: false,
              color: { kind: "hex", value: "#1a2033" },
            },
            align: "left",
            maxWidth: null,
          },
          {
            id: "form",
            type: "form_slot",
            heading: null,
            subheading: null,
            cardStyle: "shadowed",
          },
          {
            id: "footer",
            type: "footer",
            text: "POPIA compliant",
            typography: {
              family: "mono",
              weight: 500,
              size: 0.7,
              italic: false,
              lineHeight: 1.4,
              letterSpacing: 0.08,
              uppercase: true,
              color: { kind: "hex", value: "#70798f" },
            },
            align: "center",
            showPoweredBy: true,
          },
        ],
      },
    ],
  },
};

const demoClient: TemplateClient = {
  slug: "demo-corp",
  name: "Demo Corp",
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "#006341",
  brand_secondary_color: "#f2f7f4",
  brand_accent_color: "#b4c905",
  brand_text_color: "#0b0f1c",
};

const demoCampaign: TemplateCampaign = {
  slug: "senior-engineer",
  role_title: "Senior Platform Engineer",
  role_description:
    "We're looking for an experienced engineer to lead our platform team. You'll shape our technical direction and mentor a growing team.",
  department: "Engineering",
  location: "Cape Town",
  employment_type: "Full-time",
  salary_range_min: 900000,
  salary_range_max: 1_200_000,
  gating_config: [],
};

// 1) Validate the tree
const parsed = parseBlockTree(demoTree);
if (!parsed.ok) {
  console.error("❌ Demo tree failed validation:");
  for (const e of parsed.errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ Demo tree validated");

// 2) Render it to static markup
let markup: string;
try {
  markup = renderToStaticMarkup(
    BlockTreeRenderer({
      tree: parsed.tree,
      client: demoClient,
      campaign: demoCampaign,
    }) as React.ReactElement
  );
} catch (e) {
  console.error("❌ Renderer threw:", e);
  process.exit(1);
}

// 3) Sanity-check the markup contains expected substrings
const expectations = [
  "Senior Platform Engineer", // heading bound to role_title
  "Engineering", // meta field
  "Cape Town",
  "Full-time",
  "R900 000 – R1 200 000 · per annum", // salary formatter output
  "We&#x27;re looking for an experienced engineer", // role_description (React escapes ASCII apostrophe)
  "Powered by TalentStream", // footer
  "D", // logo initial (first letter of "Demo Corp")
];
let passed = 0;
for (const snippet of expectations) {
  if (markup.includes(snippet)) {
    passed++;
  } else {
    console.error(`❌ Expected markup to contain: "${snippet}"`);
  }
}
console.log(`✓ ${passed}/${expectations.length} markup expectations met`);
console.log(`  markup length: ${markup.length} chars`);

if (passed !== expectations.length) process.exit(1);
console.log("\n✅ Phase 1 foundation works end-to-end");
