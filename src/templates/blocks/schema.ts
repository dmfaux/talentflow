// ── Block-tree schema for DB-stored custom templates ───────────────
//
// Custom templates are stored as a validated JSON block tree. This file
// defines the Zod schemas, inferred TS types, and a top-level validator
// that enforces structural invariants (exactly one root, exactly one
// form_slot, unique block ids).
//
// NOTE: builtin templates (editorial/corporate/modern) do NOT use this
// schema — they render from code via the registry. Only templates with
// `source='custom'` are validated against these schemas.

import { z } from "zod";

// ── Binding fields (allow-list) ──────────────────────────────────────

export const BINDING_FIELDS = [
  "client.name",
  "client.slug",
  "campaign.role_title",
  "campaign.role_description",
  "campaign.department",
  "campaign.location",
  "campaign.employment_type",
  "campaign.salary_range_min",
  "campaign.salary_range_max",
] as const;

export type BindingField = (typeof BINDING_FIELDS)[number];

const BindingFieldSchema = z.enum(BINDING_FIELDS);

// ── Text binding: either a static string or a reference to a field ──

export const TextBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("static"), value: z.string().max(2000) }),
  z.object({ kind: z.literal("bind"), field: BindingFieldSchema }),
]);
export type TextBinding = z.infer<typeof TextBindingSchema>;

// ── Colour reference: hex literal or brand token ────────────────────

export const ColorRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hex"),
    value: z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex must be #RRGGBB"),
  }),
  z.object({
    kind: z.literal("brand"),
    token: z.enum(["primary", "secondary", "accent", "text"]),
  }),
]);
export type ColorRef = z.infer<typeof ColorRefSchema>;

// ── Typography token ─────────────────────────────────────────────────

export const TypographySchema = z.object({
  family: z.enum(["serif", "sans", "mono", "system"]),
  weight: z.union([
    z.literal(300),
    z.literal(400),
    z.literal(500),
    z.literal(600),
    z.literal(700),
  ]),
  size: z.number().min(0.5).max(6), // rem
  italic: z.boolean().default(false),
  lineHeight: z.number().min(0.9).max(2.5).default(1.4),
  letterSpacing: z.number().min(-0.05).max(0.5).default(0), // em
  uppercase: z.boolean().default(false),
  color: ColorRefSchema,
});
export type Typography = z.infer<typeof TypographySchema>;

// ── Spacing token (rem values) ──────────────────────────────────────

export const SpacingSchema = z.object({
  top: z.number().min(0).max(12).default(0),
  right: z.number().min(0).max(12).default(0),
  bottom: z.number().min(0).max(12).default(0),
  left: z.number().min(0).max(12).default(0),
});
export type Spacing = z.infer<typeof SpacingSchema>;

// ── Background ───────────────────────────────────────────────────────

export const BackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("color"), color: ColorRefSchema }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

// ── Align ────────────────────────────────────────────────────────────

const AlignSchema = z.enum(["left", "center", "right"]);
export type Align = z.infer<typeof AlignSchema>;

// ── Block id ────────────────────────────────────────────────────────
//
// Each block has a stable id (used by the editor for selection, drag
// target, keyed rendering). Enforced unique across the tree by the
// top-level refinement.

const BlockIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);

// ── Manual recursive type declaration ───────────────────────────────
//
// Zod's inference can't traverse the cycle on its own; we declare the
// TS type by hand and annotate the runtime schema with `z.ZodType<T>`.
// The payload shapes below are the SOURCE OF TRUTH — the runtime
// schemas must match these field-by-field.

type BlockBase = { id: string };

export type RootBlock = BlockBase & {
  type: "root";
  bg: Background;
  children: Block[];
};

export type ContainerBlock = BlockBase & {
  type: "container";
  maxWidth: number; // px
  padding: Spacing;
  align: Align;
  children: Block[];
};

export type LogoHeaderBlock = BlockBase & {
  type: "logo_header";
  logoHeight: number; // px
  showClientName: boolean;
  align: Align;
  clientNameTypography: Typography;
};

export type HeadingBlock = BlockBase & {
  type: "heading";
  level: 1 | 2 | 3;
  text: TextBinding;
  typography: Typography;
  align: Align;
  maxWidth: number | null; // px; null = no cap
};

export type EyebrowBlock = BlockBase & {
  type: "eyebrow";
  text: TextBinding;
  typography: Typography;
  align: Align;
};

export type MetaStripBlock = BlockBase & {
  type: "meta_strip";
  style: "dots" | "pills" | "pills-outline";
  fields: Array<
    "campaign.department" | "campaign.location" | "campaign.employment_type"
  >;
  typography: Typography;
  align: Align;
};

export type SalaryBadgeBlock = BlockBase & {
  type: "salary_badge";
  style: "pill" | "chip" | "plain";
  typography: Typography;
  align: Align;
};

export type RichTextBlock = BlockBase & {
  type: "rich_text";
  text: TextBinding;
  emptyFallback: string; // rendered when bound field resolves to null/empty
  typography: Typography;
  align: Align;
  maxWidth: number | null;
};

export type FormSlotBlock = BlockBase & {
  type: "form_slot";
  heading: string | null;
  subheading: string | null;
  cardStyle: "plain" | "bordered" | "shadowed";
};

export type DividerBlock = BlockBase & {
  type: "divider";
  color: ColorRef;
  thickness: number; // px
  inset: number; // rem, horizontal inset
};

export type SpacerBlock = BlockBase & {
  type: "spacer";
  height: number; // rem
};

export type FooterBlock = BlockBase & {
  type: "footer";
  text: string;
  typography: Typography;
  align: Align;
  showPoweredBy: boolean;
};

export type Block =
  | RootBlock
  | ContainerBlock
  | LogoHeaderBlock
  | HeadingBlock
  | EyebrowBlock
  | MetaStripBlock
  | SalaryBadgeBlock
  | RichTextBlock
  | FormSlotBlock
  | DividerBlock
  | SpacerBlock
  | FooterBlock;

// ── Runtime schemas ──────────────────────────────────────────────────
//
// `BlockSchema` is a lazy discriminated union so nested `children`
// arrays can reference it before it's defined.

// Manual type-discriminated dispatcher. We want z.discriminatedUnion
// error quality (precise paths into the failing block) but Zod 4's
// discriminated-union typing doesn't compose with lazy recursion.
// `BlockSchema` looks at the `type` field, finds the matching leaf
// schema, and parses directly — giving us precise error paths for free.

const BLOCK_TYPE_TO_SCHEMA = {
  root: () => RootSchema,
  container: () => ContainerSchema,
  logo_header: () => LogoHeaderSchema,
  heading: () => HeadingSchema,
  eyebrow: () => EyebrowSchema,
  meta_strip: () => MetaStripSchema,
  salary_badge: () => SalaryBadgeSchema,
  rich_text: () => RichTextSchema,
  form_slot: () => FormSlotSchema,
  divider: () => DividerSchema,
  spacer: () => SpacerSchema,
  footer: () => FooterSchema,
} as const;

export const BlockSchema: z.ZodType<Block> = z
  .unknown()
  .transform((val, ctx) => {
    if (typeof val !== "object" || val === null || Array.isArray(val)) {
      ctx.addIssue({ code: "custom", message: "block must be an object" });
      return z.NEVER;
    }
    const type = (val as { type?: unknown }).type;
    if (typeof type !== "string") {
      ctx.addIssue({ code: "custom", message: "block.type is required" });
      return z.NEVER;
    }
    const loader = BLOCK_TYPE_TO_SCHEMA[type as keyof typeof BLOCK_TYPE_TO_SCHEMA];
    if (!loader) {
      ctx.addIssue({
        code: "custom",
        message: `unknown block type: "${type}"`,
        path: ["type"],
      });
      return z.NEVER;
    }
    const result = loader().safeParse(val);
    if (!result.success) {
      for (const issue of result.error.issues) {
        // Zod's $ZodIssue union is wider than addIssue's input type at
        // compile time, but forwarding through is safe at runtime.
        ctx.addIssue(issue as Parameters<typeof ctx.addIssue>[0]);
      }
      return z.NEVER;
    }
    return result.data as Block;
  }) as z.ZodType<Block>;

const RootSchema: z.ZodType<RootBlock> = z.object({
  id: BlockIdSchema,
  type: z.literal("root"),
  bg: BackgroundSchema,
  children: z.array(z.lazy(() => BlockSchema)),
});

const ContainerSchema: z.ZodType<ContainerBlock> = z.object({
  id: BlockIdSchema,
  type: z.literal("container"),
  maxWidth: z.number().int().min(320).max(1600),
  padding: SpacingSchema,
  align: AlignSchema,
  children: z.array(z.lazy(() => BlockSchema)),
});

const LogoHeaderSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("logo_header"),
  logoHeight: z.number().int().min(24).max(200),
  showClientName: z.boolean(),
  align: AlignSchema,
  clientNameTypography: TypographySchema,
});

const HeadingSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: TextBindingSchema,
  typography: TypographySchema,
  align: AlignSchema,
  maxWidth: z.number().int().min(120).max(1400).nullable(),
});

const EyebrowSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("eyebrow"),
  text: TextBindingSchema,
  typography: TypographySchema,
  align: AlignSchema,
});

const MetaStripSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("meta_strip"),
  style: z.enum(["dots", "pills", "pills-outline"]),
  fields: z.array(
    z.enum([
      "campaign.department",
      "campaign.location",
      "campaign.employment_type",
    ])
  ).min(1),
  typography: TypographySchema,
  align: AlignSchema,
});

const SalaryBadgeSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("salary_badge"),
  style: z.enum(["pill", "chip", "plain"]),
  typography: TypographySchema,
  align: AlignSchema,
});

const RichTextSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("rich_text"),
  text: TextBindingSchema,
  emptyFallback: z.string().max(500),
  typography: TypographySchema,
  align: AlignSchema,
  maxWidth: z.number().int().min(120).max(1400).nullable(),
});

const FormSlotSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("form_slot"),
  heading: z.string().max(200).nullable(),
  subheading: z.string().max(500).nullable(),
  cardStyle: z.enum(["plain", "bordered", "shadowed"]),
});

const DividerSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("divider"),
  color: ColorRefSchema,
  thickness: z.number().min(1).max(16),
  inset: z.number().min(0).max(10),
});

const SpacerSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("spacer"),
  height: z.number().min(0).max(16),
});

const FooterSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("footer"),
  text: z.string().max(500),
  typography: TypographySchema,
  align: AlignSchema,
  showPoweredBy: z.boolean(),
});

// ── Tree — the stored JSON value ─────────────────────────────────────

export const BlockTreeSchema = z
  .object({
    version: z.literal(1),
    root: RootSchema,
  })
  .superRefine((tree, ctx) => {
    // Structural invariants: exactly one form_slot, unique ids.
    const seen = new Set<string>();
    let formSlotCount = 0;
    let duplicateId: string | null = null;

    const walk = (block: Block) => {
      if (seen.has(block.id)) duplicateId = block.id;
      seen.add(block.id);
      if (block.type === "form_slot") formSlotCount++;
      if (block.type === "root" || block.type === "container") {
        for (const child of block.children) walk(child);
      }
    };
    walk(tree.root);

    if (formSlotCount !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `Tree must contain exactly one form_slot block (found ${formSlotCount})`,
        path: ["root"],
      });
    }
    if (duplicateId) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate block id: "${duplicateId}"`,
        path: ["root"],
      });
    }
  });

export type BlockTree = z.infer<typeof BlockTreeSchema>;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse a raw JSON value into a validated BlockTree. Returns either the
 * parsed tree or a structured error array suitable for returning from
 * an API route.
 */
export function parseBlockTree(
  raw: unknown
): { ok: true; tree: BlockTree } | { ok: false; errors: string[] } {
  const result = BlockTreeSchema.safeParse(raw);
  if (result.success) return { ok: true, tree: result.data };
  const errors = result.error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join(".") : "(root)";
    return `${path}: ${i.message}`;
  });
  return { ok: false, errors };
}

/**
 * Walk a block tree, calling `visit` for every block. Useful for the
 * renderer, editor tree view, and any static analysis.
 */
export function walkBlocks(
  root: Block,
  visit: (block: Block, depth: number) => void
): void {
  const go = (b: Block, depth: number) => {
    visit(b, depth);
    if (b.type === "root" || b.type === "container") {
      for (const child of b.children) go(child, depth + 1);
    }
  };
  go(root, 0);
}
