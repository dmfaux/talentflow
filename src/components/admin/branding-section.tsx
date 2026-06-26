"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type LogoBackground = "light" | "dark" | "transparent";
export type LogoPosition = "top-left" | "top-centre";

export interface BrandingValues {
  logo_url: string | null;
  logo_background: LogoBackground;
  logo_position: LogoPosition;
  brand_primary_color: string;
  brand_secondary_color: string;
  brand_accent_color: string;
  brand_text_color: string;
}

interface Props {
  clientId: string;
  values: BrandingValues;
  onChange: (patch: Partial<BrandingValues>) => void;
}

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];
const MAX_SIZE = 2 * 1024 * 1024;

const COLOR_HELP: Record<keyof BrandingValues | string, string> = {
  brand_primary_color:
    "This brand's primary colour. Used for headlines, buttons, and key accents on its campaign page.",
  brand_secondary_color:
    "Supporting colour. Used for backgrounds and secondary elements.",
  brand_accent_color:
    "Optional highlight colour for badges and small accents.",
  brand_text_color:
    "Body text colour for this brand's campaign pages. Should have strong contrast against the background.",
  logo_background:
    "Choose the background that makes your logo look best. This preview helps you see how the logo will appear on your campaign pages.",
};

const LOGO_BG_SWATCHES: Record<LogoBackground, string> = {
  light: "#ffffff",
  dark: "#11123c",
  transparent: "transparent",
};

function normaliseHex(value: string): string {
  const trimmed = value.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  return `#${withoutHash.toLowerCase()}`;
}

function isValidHex(value: string): boolean {
  const v = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v);
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Extract up to 3 dominant non-white / non-black colours from an image URL
 * by quantising pixel values to a 32-level bucket and ranking by count.
 */
async function extractDominantColors(url: string, max = 3): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(120 / img.width, 120 / img.height, 1);
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 200) continue; // skip transparent
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // skip near white / near black
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max > 240 && min > 240) continue;
          if (max < 25) continue;
          // skip low saturation greys
          if (max - min < 18) continue;
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.count++;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
          }
        }
        const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
        const colors = sorted.slice(0, max).map((b) =>
          rgbToHex(Math.round(b.r / b.count), Math.round(b.g / b.count), Math.round(b.b / b.count))
        );
        resolve(colors);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });
}

export function BrandingSection({ clientId, values, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError("Only PNG, JPG, and SVG files are accepted");
      return;
    }
    if (file.size > MAX_SIZE) {
      setUploadError("Logo must be under 2MB");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("client_id", clientId);
      formData.append("logo", file);

      const res = await fetch("/api/admin/clients/logo", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        setUploadError(json.error || "Upload failed");
        return;
      }
      onChange({ logo_url: json.data.url });
    } catch {
      setUploadError("Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSuggestFromLogo() {
    if (!values.logo_url) return;
    setSuggesting(true);
    setSuggestError("");
    try {
      const colors = await extractDominantColors(values.logo_url, 3);
      if (colors.length === 0) {
        setSuggestError("Could not extract colours from this logo");
        return;
      }
      const patch: Partial<BrandingValues> = {
        brand_primary_color: colors[0],
      };
      if (colors[1]) patch.brand_secondary_color = colors[1];
      if (colors[2]) patch.brand_accent_color = colors[2];
      onChange(patch);
    } catch {
      setSuggestError("Could not load logo image. Try saving the logo first.");
    } finally {
      setSuggesting(false);
    }
  }

  function handleHexChange(field: keyof BrandingValues, value: string) {
    // Allow user to type freely; only normalise on blur
    onChange({ [field]: value } as Partial<BrandingValues>);
  }

  function handleHexBlur(field: keyof BrandingValues) {
    const value = values[field] as string;
    if (value && isValidHex(value)) {
      const normalised = normaliseHex(value);
      if (normalised !== value) onChange({ [field]: normalised } as Partial<BrandingValues>);
    }
  }

  function handlePickerChange(field: keyof BrandingValues, value: string) {
    onChange({ [field]: value.toLowerCase() } as Partial<BrandingValues>);
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Branding</h2>
        <p className="mt-1 text-xs text-ink-muted">
          This brand&apos;s logo and colours. These drive how its campaign pages appear to candidates.
        </p>
      </div>

      {/* ── Logo upload ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <label className="block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
          Logo
        </label>

        <div className="flex items-start gap-4">
          <LogoPreviewBox logoUrl={values.logo_url} background={values.logo_background} />

          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                loading={uploading}
              >
                {values.logo_url ? "Replace logo" : "Upload logo"}
              </Button>
              {values.logo_url && (
                <button
                  type="button"
                  onClick={() => onChange({ logo_url: null })}
                  className="inline-flex h-9 items-center px-3 text-[0.75rem] font-medium text-ink-muted transition-colors hover:text-red cursor-pointer"
                >
                  Remove
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
            <p className="text-[0.7rem] text-ink-muted">PNG, JPG, or SVG. Max 2MB.</p>
            {uploadError && <p className="text-xs text-red">{uploadError}</p>}
          </div>
        </div>
      </div>

      {/* ── Logo background ─────────────────────────────────────── */}
      <div className="space-y-2">
        <label className="block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
          Logo Background
        </label>
        <p className="text-[0.7rem] text-ink-muted">{COLOR_HELP.logo_background}</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(LOGO_BG_SWATCHES) as LogoBackground[]).map((bg) => (
            <button
              key={bg}
              type="button"
              onClick={() => onChange({ logo_background: bg })}
              className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                values.logo_background === bg
                  ? "border-cobalt bg-cobalt-tint"
                  : "border-rule bg-surface hover:border-rule-strong"
              }`}
            >
              <span
                className="h-6 w-6 shrink-0 rounded border border-rule"
                style={
                  bg === "transparent"
                    ? {
                        backgroundImage:
                          "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                        backgroundSize: "8px 8px",
                        backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
                      }
                    : { backgroundColor: LOGO_BG_SWATCHES[bg] }
                }
              />
              <span className="text-[0.8rem] font-medium capitalize text-ink">{bg}</span>
            </button>
          ))}
        </div>
        </div>

      {/* ── Logo position ───────────────────────────────────────── */}
      <div>
        <label className="block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-ink-muted mb-2">
          Logo Position
        </label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: "top-left", label: "Top Left", icon: "left" },
            { value: "top-centre", label: "Top Centre", icon: "centre" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ logo_position: opt.value })}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                values.logo_position === opt.value
                  ? "border-cobalt bg-cobalt-tint"
                  : "border-rule bg-surface hover:border-rule-strong"
              }`}
            >
              <PositionIcon variant={opt.icon} />
              <span className="text-[0.8rem] font-medium text-ink">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Brand colours ───────────────────────────────────────── */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <label className="block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
            Brand Colours
          </label>
          <button
            type="button"
            onClick={handleSuggestFromLogo}
            disabled={!values.logo_url || suggesting}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rule bg-surface px-2.5 text-[0.7rem] font-medium text-ink transition-colors hover:bg-canvas cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={values.logo_url ? "Extract dominant colours from the uploaded logo" : "Upload a logo first"}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 1l1.5 3L11 4.5l-2.5 2.5L9 10.5 6 9l-3 1.5L3.5 7 1 4.5 4.5 4 6 1z" />
            </svg>
            Suggest from logo
          </button>
        </div>
        {suggestError && <p className="text-xs text-red">{suggestError}</p>}

        <ColorInput
          label="Primary"
          value={values.brand_primary_color}
          helpText={COLOR_HELP.brand_primary_color}
          onChange={(v) => handleHexChange("brand_primary_color", v)}
          onBlur={() => handleHexBlur("brand_primary_color")}
          onPickerChange={(v) => handlePickerChange("brand_primary_color", v)}
        />
        <ColorInput
          label="Secondary"
          value={values.brand_secondary_color}
          helpText={COLOR_HELP.brand_secondary_color}
          onChange={(v) => handleHexChange("brand_secondary_color", v)}
          onBlur={() => handleHexBlur("brand_secondary_color")}
          onPickerChange={(v) => handlePickerChange("brand_secondary_color", v)}
        />
        <ColorInput
          label="Accent"
          optional
          value={values.brand_accent_color}
          helpText={COLOR_HELP.brand_accent_color}
          onChange={(v) => handleHexChange("brand_accent_color", v)}
          onBlur={() => handleHexBlur("brand_accent_color")}
          onPickerChange={(v) => handlePickerChange("brand_accent_color", v)}
        />
        <ColorInput
          label="Text"
          value={values.brand_text_color}
          helpText={COLOR_HELP.brand_text_color}
          onChange={(v) => handleHexChange("brand_text_color", v)}
          onBlur={() => handleHexBlur("brand_text_color")}
          onPickerChange={(v) => handlePickerChange("brand_text_color", v)}
        />
      </div>
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function LogoPreviewBox({
  logoUrl,
  background,
}: {
  logoUrl: string | null;
  background: LogoBackground;
}) {
  const bgStyle =
    background === "transparent"
      ? {
          backgroundImage:
            "linear-gradient(45deg, #d1dce6 25%, transparent 25%), linear-gradient(-45deg, #d1dce6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1dce6 75%), linear-gradient(-45deg, transparent 75%, #d1dce6 75%)",
          backgroundSize: "12px 12px",
          backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
        }
      : { backgroundColor: background === "light" ? "#ffffff" : "#11123c" };

  return (
    <div
      className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-rule"
      style={bgStyle}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="Logo preview" className="max-h-[80%] max-w-[80%] object-contain" />
      ) : (
        <span className="font-mono text-[0.65rem] text-ink-muted">no logo</span>
      )}
    </div>
  );
}

function PositionIcon({ variant }: { variant: "left" | "centre" }) {
  return (
    <div className="flex h-5 w-7 items-center overflow-hidden rounded border border-rule bg-canvas">
      <div
        className={`h-1.5 rounded-sm bg-ink-soft ${
          variant === "left" ? "ml-0.5 w-2" : "mx-auto w-2"
        }`}
      />
    </div>
  );
}

function ColorInput({
  label,
  value,
  helpText,
  optional,
  onChange,
  onBlur,
  onPickerChange,
}: {
  label: string;
  value: string;
  helpText: string;
  optional?: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
  onPickerChange: (v: string) => void;
}) {
  const pickerValue = isValidHex(value) ? normaliseHex(value) : "#000000";
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-rule">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: isValidHex(value) ? normaliseHex(value) : "#ffffff" }}
          />
          <input
            type="color"
            value={pickerValue}
            onChange={(e) => onPickerChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`${label} colour picker`}
          />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[0.8rem] font-medium text-ink">{label}</span>
            {optional && (
              <span className="text-[0.65rem] font-medium uppercase tracking-[0.1em] text-ink-muted">
                optional
              </span>
            )}
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder="#000000"
            className="mt-1 h-8 w-full rounded-lg border border-rule bg-canvas/40 px-2.5 font-mono text-xs text-ink placeholder:text-ink-muted outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20"
          />
        </div>
      </div>
      <p className="text-[0.7rem] text-ink-muted pl-[3.25rem]">{helpText}</p>
    </div>
  );
}
