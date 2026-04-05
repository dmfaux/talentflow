"use client";

// Per-block property panels. Each takes a block and returns a panel
// that calls onChange with the full updated block. The dispatcher at
// the bottom picks the right panel based on block.type.

import type {
  Block,
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
} from "@/templates/blocks/schema";
import {
  AlignControl,
  CheckboxInput,
  ColorControl,
  EnumSelect,
  NumberInput,
  SECTION_LABEL,
  TextBindingControl,
  TextInput,
  TypographyControl,
} from "./controls";

type OnChange<T> = (next: T) => void;

// ── Block panels ────────────────────────────────────────────────────

function RootPanel({ block, onChange }: { block: RootBlock; onChange: OnChange<RootBlock> }) {
  const bgKind = block.bg.kind;
  return (
    <div className="space-y-2">
      <EnumSelect
        label="Background"
        value={bgKind}
        options={[
          { value: "none", label: "None" },
          { value: "color", label: "Color" },
        ]}
        onChange={(kind) => {
          if (kind === "none") onChange({ ...block, bg: { kind: "none" } });
          else
            onChange({
              ...block,
              bg: { kind: "color", color: { kind: "hex", value: "#ffffff" } },
            });
        }}
      />
      {block.bg.kind === "color" && (
        <ColorControl
          label="Background color"
          value={block.bg.color}
          onChange={(color) =>
            onChange({ ...block, bg: { kind: "color", color } })
          }
        />
      )}
    </div>
  );
}

function ContainerPanel({
  block,
  onChange,
}: {
  block: ContainerBlock;
  onChange: OnChange<ContainerBlock>;
}) {
  const p = block.padding;
  const patchPadding = (k: keyof typeof p, v: number) =>
    onChange({ ...block, padding: { ...p, [k]: v } });
  return (
    <div className="space-y-3">
      <NumberInput
        label="Max width"
        value={block.maxWidth}
        onChange={(v) => onChange({ ...block, maxWidth: v ?? block.maxWidth })}
        min={320}
        max={1600}
        step={20}
        suffix="px"
      />
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <div>
        <span className={SECTION_LABEL}>Padding</span>
        <div className="grid grid-cols-4 gap-1.5">
          <NumberInput label="Top" value={p.top} onChange={(v) => patchPadding("top", v ?? 0)} min={0} max={12} step={0.25} />
          <NumberInput label="Right" value={p.right} onChange={(v) => patchPadding("right", v ?? 0)} min={0} max={12} step={0.25} />
          <NumberInput label="Bottom" value={p.bottom} onChange={(v) => patchPadding("bottom", v ?? 0)} min={0} max={12} step={0.25} />
          <NumberInput label="Left" value={p.left} onChange={(v) => patchPadding("left", v ?? 0)} min={0} max={12} step={0.25} />
        </div>
      </div>
    </div>
  );
}

function LogoHeaderPanel({
  block,
  onChange,
}: {
  block: LogoHeaderBlock;
  onChange: OnChange<LogoHeaderBlock>;
}) {
  return (
    <div className="space-y-3">
      <NumberInput
        label="Logo height"
        value={block.logoHeight}
        onChange={(v) => onChange({ ...block, logoHeight: v ?? block.logoHeight })}
        min={24}
        max={200}
        step={4}
        suffix="px"
      />
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <CheckboxInput
        label="Show client name"
        value={block.showClientName}
        onChange={(showClientName) => onChange({ ...block, showClientName })}
      />
      <TypographyControl
        value={block.clientNameTypography}
        onChange={(clientNameTypography) =>
          onChange({ ...block, clientNameTypography })
        }
      />
    </div>
  );
}

function HeadingPanel({
  block,
  onChange,
}: {
  block: HeadingBlock;
  onChange: OnChange<HeadingBlock>;
}) {
  return (
    <div className="space-y-3">
      <EnumSelect
        label="Heading level"
        value={String(block.level)}
        options={[
          { value: "1", label: "H1" },
          { value: "2", label: "H2" },
          { value: "3", label: "H3" },
        ]}
        onChange={(v) => onChange({ ...block, level: Number(v) as 1 | 2 | 3 })}
      />
      <TextBindingControl
        label="Text"
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
      />
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <NumberInput
        label="Max width"
        value={block.maxWidth}
        onChange={(v) => onChange({ ...block, maxWidth: v })}
        min={120}
        max={1400}
        step={20}
        suffix="px or blank"
      />
      <TypographyControl
        value={block.typography}
        onChange={(typography) => onChange({ ...block, typography })}
      />
    </div>
  );
}

function EyebrowPanel({
  block,
  onChange,
}: {
  block: EyebrowBlock;
  onChange: OnChange<EyebrowBlock>;
}) {
  return (
    <div className="space-y-3">
      <TextBindingControl
        label="Text"
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
      />
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <TypographyControl
        value={block.typography}
        onChange={(typography) => onChange({ ...block, typography })}
      />
    </div>
  );
}

function MetaStripPanel({
  block,
  onChange,
}: {
  block: MetaStripBlock;
  onChange: OnChange<MetaStripBlock>;
}) {
  type MetaField = MetaStripBlock["fields"][number];
  const availableFields: Array<{ value: MetaField; label: string }> = [
    { value: "campaign.department", label: "Department" },
    { value: "campaign.location", label: "Location" },
    { value: "campaign.employment_type", label: "Employment type" },
  ];
  const toggle = (field: MetaField) => {
    const on = block.fields.includes(field);
    const next = on
      ? block.fields.filter((f) => f !== field)
      : [...block.fields, field];
    if (next.length === 0) return; // schema requires at least 1
    onChange({ ...block, fields: next });
  };
  return (
    <div className="space-y-3">
      <EnumSelect
        label="Style"
        value={block.style}
        options={[
          { value: "dots", label: "Dots · separated" },
          { value: "pills", label: "Pills (filled)" },
          { value: "pills-outline", label: "Pills (outline)" },
        ]}
        onChange={(style) => onChange({ ...block, style })}
      />
      <div>
        <span className={SECTION_LABEL}>Fields shown</span>
        <div className="space-y-1.5">
          {availableFields.map((f) => (
            <CheckboxInput
              key={f.value}
              label={f.label}
              value={block.fields.includes(f.value)}
              onChange={() => toggle(f.value)}
            />
          ))}
        </div>
      </div>
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <TypographyControl
        value={block.typography}
        onChange={(typography) => onChange({ ...block, typography })}
      />
    </div>
  );
}

function SalaryBadgePanel({
  block,
  onChange,
}: {
  block: SalaryBadgeBlock;
  onChange: OnChange<SalaryBadgeBlock>;
}) {
  return (
    <div className="space-y-3">
      <EnumSelect
        label="Style"
        value={block.style}
        options={[
          { value: "pill", label: "Pill" },
          { value: "chip", label: "Chip" },
          { value: "plain", label: "Plain text" },
        ]}
        onChange={(style) => onChange({ ...block, style })}
      />
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <TypographyControl
        value={block.typography}
        onChange={(typography) => onChange({ ...block, typography })}
      />
    </div>
  );
}

function RichTextPanel({
  block,
  onChange,
}: {
  block: RichTextBlock;
  onChange: OnChange<RichTextBlock>;
}) {
  return (
    <div className="space-y-3">
      <TextBindingControl
        label="Text"
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
      />
      <TextInput
        label="Empty fallback"
        value={block.emptyFallback}
        onChange={(emptyFallback) => onChange({ ...block, emptyFallback })}
        placeholder="Shown when bound text resolves to empty"
      />
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <NumberInput
        label="Max width"
        value={block.maxWidth}
        onChange={(v) => onChange({ ...block, maxWidth: v })}
        min={120}
        max={1400}
        step={20}
        suffix="px or blank"
      />
      <TypographyControl
        value={block.typography}
        onChange={(typography) => onChange({ ...block, typography })}
      />
    </div>
  );
}

function FormSlotPanel({
  block,
  onChange,
}: {
  block: FormSlotBlock;
  onChange: OnChange<FormSlotBlock>;
}) {
  return (
    <div className="space-y-3">
      <TextInput
        label="Heading"
        value={block.heading ?? ""}
        onChange={(v) => onChange({ ...block, heading: v || null })}
        placeholder="Apply for this role"
      />
      <TextInput
        label="Subheading"
        value={block.subheading ?? ""}
        onChange={(v) => onChange({ ...block, subheading: v || null })}
        placeholder="optional"
      />
      <EnumSelect
        label="Card style"
        value={block.cardStyle}
        options={[
          { value: "plain", label: "Plain" },
          { value: "bordered", label: "Bordered" },
          { value: "shadowed", label: "Shadowed" },
        ]}
        onChange={(cardStyle) => onChange({ ...block, cardStyle })}
      />
    </div>
  );
}

function DividerPanel({
  block,
  onChange,
}: {
  block: DividerBlock;
  onChange: OnChange<DividerBlock>;
}) {
  return (
    <div className="space-y-3">
      <ColorControl
        label="Color"
        value={block.color}
        onChange={(color) => onChange({ ...block, color })}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="Thickness"
          value={block.thickness}
          onChange={(v) => onChange({ ...block, thickness: v ?? 1 })}
          min={1}
          max={16}
          step={1}
          suffix="px"
        />
        <NumberInput
          label="Inset"
          value={block.inset}
          onChange={(v) => onChange({ ...block, inset: v ?? 0 })}
          min={0}
          max={10}
          step={0.5}
          suffix="rem"
        />
      </div>
    </div>
  );
}

function SpacerPanel({
  block,
  onChange,
}: {
  block: SpacerBlock;
  onChange: OnChange<SpacerBlock>;
}) {
  return (
    <div>
      <NumberInput
        label="Height"
        value={block.height}
        onChange={(v) => onChange({ ...block, height: v ?? 0 })}
        min={0}
        max={16}
        step={0.25}
        suffix="rem"
      />
    </div>
  );
}

function FooterPanel({
  block,
  onChange,
}: {
  block: FooterBlock;
  onChange: OnChange<FooterBlock>;
}) {
  return (
    <div className="space-y-3">
      <TextInput
        label="Text"
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
        placeholder="POPIA compliant"
      />
      <CheckboxInput
        label="Show 'Powered by TalentStream'"
        value={block.showPoweredBy}
        onChange={(showPoweredBy) => onChange({ ...block, showPoweredBy })}
      />
      <AlignControl value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <TypographyControl
        value={block.typography}
        onChange={(typography) => onChange({ ...block, typography })}
      />
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────

export function BlockPanel({
  block,
  onChange,
}: {
  block: Block;
  onChange: (next: Block) => void;
}) {
  switch (block.type) {
    case "root":
      return <RootPanel block={block} onChange={onChange} />;
    case "container":
      return <ContainerPanel block={block} onChange={onChange} />;
    case "logo_header":
      return <LogoHeaderPanel block={block} onChange={onChange} />;
    case "heading":
      return <HeadingPanel block={block} onChange={onChange} />;
    case "eyebrow":
      return <EyebrowPanel block={block} onChange={onChange} />;
    case "meta_strip":
      return <MetaStripPanel block={block} onChange={onChange} />;
    case "salary_badge":
      return <SalaryBadgePanel block={block} onChange={onChange} />;
    case "rich_text":
      return <RichTextPanel block={block} onChange={onChange} />;
    case "form_slot":
      return <FormSlotPanel block={block} onChange={onChange} />;
    case "divider":
      return <DividerPanel block={block} onChange={onChange} />;
    case "spacer":
      return <SpacerPanel block={block} onChange={onChange} />;
    case "footer":
      return <FooterPanel block={block} onChange={onChange} />;
  }
}
