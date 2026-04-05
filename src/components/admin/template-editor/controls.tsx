"use client";

import type {
  Align,
  BindingField,
  ColorRef,
  TextBinding,
  Typography,
} from "@/templates/blocks/schema";
import { BINDING_FIELDS } from "@/templates/blocks/schema";

// ── Shared styling ──────────────────────────────────────────────────

const INPUT =
  "h-8 w-full rounded-md border border-border bg-cream/40 px-2.5 text-[0.8rem] text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
const LABEL =
  "mb-1 block text-[0.62rem] font-medium uppercase tracking-[0.1em] text-txt-muted";
const SECTION_LABEL =
  "mb-2 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

// ── Primitive controls ─────────────────────────────────────────────

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </div>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div>
      <label className={LABEL}>
        {label}
        {suffix && (
          <span className="ml-1 text-[0.6rem] normal-case tracking-normal text-txt-muted">
            ({suffix})
          </span>
        )}
      </label>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(null);
          else {
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(n);
          }
        }}
        className={INPUT}
      />
    </div>
  );
}

export function CheckboxInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[0.78rem] text-charcoal cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-border text-cobalt focus:ring-cobalt/20"
      />
      {label}
    </label>
  );
}

export function EnumSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={INPUT}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Domain-specific controls ──────────────────────────────────────

export function AlignControl({
  value,
  onChange,
}: {
  value: Align;
  onChange: (v: Align) => void;
}) {
  const options: Array<{ v: Align; label: string }> = [
    { v: "left", label: "L" },
    { v: "center", label: "C" },
    { v: "right", label: "R" },
  ];
  return (
    <div>
      <label className={LABEL}>Align</label>
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`h-8 w-10 text-[0.72rem] font-medium transition-colors cursor-pointer ${
              value === o.v
                ? "bg-ink text-paper"
                : "bg-cream/40 text-ink-muted hover:text-charcoal"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ColorRef;
  onChange: (v: ColorRef) => void;
}) {
  const kind = value.kind;
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="flex gap-1.5">
        <select
          value={kind}
          onChange={(e) => {
            const nextKind = e.target.value as "hex" | "brand";
            if (nextKind === "hex")
              onChange({ kind: "hex", value: "#0b0f1c" });
            else onChange({ kind: "brand", token: "primary" });
          }}
          className={`${INPUT} w-[88px] flex-none`}
        >
          <option value="hex">Hex</option>
          <option value="brand">Brand</option>
        </select>
        {kind === "hex" ? (
          <>
            <input
              type="color"
              value={value.value}
              onChange={(e) =>
                onChange({ kind: "hex", value: e.target.value })
              }
              className="h-8 w-8 flex-none rounded-md border border-border cursor-pointer"
            />
            <input
              type="text"
              value={value.value}
              placeholder="#RRGGBB"
              onChange={(e) =>
                onChange({ kind: "hex", value: e.target.value.trim() })
              }
              className={`${INPUT} font-mono flex-1`}
            />
          </>
        ) : (
          <select
            value={value.token}
            onChange={(e) =>
              onChange({
                kind: "brand",
                token: e.target.value as "primary" | "secondary" | "accent" | "text",
              })
            }
            className={`${INPUT} flex-1`}
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="accent">Accent</option>
            <option value="text">Text</option>
          </select>
        )}
      </div>
    </div>
  );
}

export function TextBindingControl({
  label,
  value,
  onChange,
  fields = BINDING_FIELDS,
}: {
  label: string;
  value: TextBinding;
  onChange: (v: TextBinding) => void;
  fields?: ReadonlyArray<BindingField>;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="flex gap-1.5">
        <select
          value={value.kind}
          onChange={(e) => {
            const nextKind = e.target.value as "static" | "bind";
            if (nextKind === "static") onChange({ kind: "static", value: "" });
            else onChange({ kind: "bind", field: fields[0] });
          }}
          className={`${INPUT} w-[88px] flex-none`}
        >
          <option value="static">Static</option>
          <option value="bind">Bind</option>
        </select>
        {value.kind === "static" ? (
          <input
            type="text"
            value={value.value}
            placeholder="Text content"
            onChange={(e) => onChange({ kind: "static", value: e.target.value })}
            className={`${INPUT} flex-1`}
          />
        ) : (
          <select
            value={value.field}
            onChange={(e) =>
              onChange({ kind: "bind", field: e.target.value as BindingField })
            }
            className={`${INPUT} flex-1 font-mono text-[0.72rem]`}
          >
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

const FAMILY_OPTIONS: ReadonlyArray<{
  value: Typography["family"];
  label: string;
}> = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Mono" },
  { value: "system", label: "System" },
];

const WEIGHT_OPTIONS: ReadonlyArray<{
  value: Typography["weight"];
  label: string;
}> = [
  { value: 300, label: "Light (300)" },
  { value: 400, label: "Regular (400)" },
  { value: 500, label: "Medium (500)" },
  { value: 600, label: "Semibold (600)" },
  { value: 700, label: "Bold (700)" },
];

export function TypographyControl({
  value,
  onChange,
}: {
  value: Typography;
  onChange: (v: Typography) => void;
}) {
  const patch = (p: Partial<Typography>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-2">
      <span className={SECTION_LABEL}>Typography</span>
      <div className="grid grid-cols-2 gap-2">
        <EnumSelect
          label="Family"
          value={value.family}
          options={FAMILY_OPTIONS}
          onChange={(family) => patch({ family })}
        />
        <EnumSelect
          label="Weight"
          value={String(value.weight)}
          options={WEIGHT_OPTIONS.map((o) => ({
            value: String(o.value),
            label: o.label,
          }))}
          onChange={(w) => patch({ weight: Number(w) as Typography["weight"] })}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberInput
          label="Size"
          value={value.size}
          onChange={(v) => patch({ size: v ?? value.size })}
          min={0.5}
          max={6}
          step={0.05}
          suffix="rem"
        />
        <NumberInput
          label="Line"
          value={value.lineHeight}
          onChange={(v) => patch({ lineHeight: v ?? value.lineHeight })}
          min={0.9}
          max={2.5}
          step={0.05}
        />
        <NumberInput
          label="Tracking"
          value={value.letterSpacing}
          onChange={(v) => patch({ letterSpacing: v ?? value.letterSpacing })}
          min={-0.05}
          max={0.5}
          step={0.01}
          suffix="em"
        />
      </div>
      <div className="flex items-center gap-4">
        <CheckboxInput
          label="Italic"
          value={value.italic}
          onChange={(italic) => patch({ italic })}
        />
        <CheckboxInput
          label="Uppercase"
          value={value.uppercase}
          onChange={(uppercase) => patch({ uppercase })}
        />
      </div>
      <ColorControl
        label="Color"
        value={value.color}
        onChange={(color) => patch({ color })}
      />
    </div>
  );
}

export { SECTION_LABEL };
