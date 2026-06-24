import { describe, it, expect } from "vitest";
import {
  DEFAULT_THEME_SEEDS,
  hexToHsl,
  hslToHex,
  contrastRatio,
  readableTextOn,
  derivePalette,
  type DerivedPalette,
} from "./theme-colors";

const HEX_RE = /^#[0-9a-f]{6}$/;

describe("hexToHsl / hslToHex round trip", () => {
  it("re-parses greyscale exactly (lossless)", () => {
    // Pure greys carry no hue/saturation, so the HSL round trip is exact.
    for (const hex of ["#ffffff", "#000000", "#808080"]) {
      const { h, s, l } = hexToHsl(hex);
      expect(hslToHex(h, s, l)).toBe(hex);
    }
  });

  it("round-trips chromatic colours within a small rounding tolerance", () => {
    // Integer HSL loses a little precision; per spec we assert closeness, not
    // exact equality, for saturated colours.
    const samples = ["#2c5bff", "#05dbd6", "#f0f3f7", "#0c1020", "#ff8800", "#123456"];
    for (const hex of samples) {
      const a = hexToHsl(hex);
      const b = hexToHsl(hslToHex(a.h, a.s, a.l));
      // Lightness should be very close.
      expect(Math.abs(a.l - b.l)).toBeLessThanOrEqual(2);
      // Hue is meaningless for near-grey colours (low saturation); only check
      // hue stability when the colour is reasonably saturated.
      if (a.s > 10) {
        const hueDelta = Math.min(
          Math.abs(a.h - b.h),
          360 - Math.abs(a.h - b.h),
        );
        expect(hueDelta).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe("contrastRatio", () => {
  it("white vs black is ~21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });

  it("identical colours are ~1", () => {
    expect(contrastRatio("#2c5bff", "#2c5bff")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(
      contrastRatio("#000000", "#ffffff"),
      5,
    );
  });

  it("primary vs white is > 4", () => {
    expect(contrastRatio("#2c5bff", "#ffffff")).toBeGreaterThan(4);
  });
});

describe("readableTextOn", () => {
  it("picks white on a dark brand primary (default cobalt) — byte-identical to the old hard-coded white", () => {
    expect(readableTextOn("#2c5bff")).toBe("#ffffff");
  });

  it("picks black on a light brand primary (e.g. a yellow) so the button label stays legible", () => {
    expect(readableTextOn("#ffdd00")).toBe("#000000");
    expect(readableTextOn("#ffcc00")).toBe("#000000");
  });

  it("always returns the higher-contrast of black/white for any background", () => {
    for (const bg of ["#2c5bff", "#ffdd00", "#006341", "#f0f3f7", "#14161c"]) {
      const chosen = readableTextOn(bg);
      const other = chosen === "#ffffff" ? "#000000" : "#ffffff";
      expect(contrastRatio(chosen, bg)).toBeGreaterThanOrEqual(
        contrastRatio(other, bg),
      );
    }
  });
});

function expectValidPalette(p: DerivedPalette): void {
  const keys: (keyof DerivedPalette)[] = [
    "bg",
    "card",
    "primary",
    "primaryDeep",
    "primaryTint",
    "accent",
    "ink",
    "inkSoft",
    "inkMuted",
    "inkFaint",
    "border",
  ];
  expect(Object.keys(p).sort()).toEqual([...keys].sort());
  for (const key of keys) {
    expect(p[key]).toMatch(HEX_RE);
  }
}

describe("derivePalette — default (light) seeds", () => {
  const p = derivePalette(DEFAULT_THEME_SEEDS);

  it("returns all 11 keys, each a valid lowercase #rrggbb", () => {
    expectValidPalette(p);
  });

  it("echoes the normalised seeds for primary/accent/bg", () => {
    expect(p.primary).toBe(DEFAULT_THEME_SEEDS.primary);
    expect(p.accent).toBe(DEFAULT_THEME_SEEDS.accent);
    expect(p.bg).toBe(DEFAULT_THEME_SEEDS.bg);
  });

  it("satisfies the contrast guards against card", () => {
    expect(contrastRatio(p.ink, p.card)).toBeGreaterThanOrEqual(7.0);
    expect(contrastRatio(p.inkSoft, p.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.inkMuted, p.card)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("derivePalette — dark bg seed", () => {
  const p = derivePalette({
    primary: "#2c5bff",
    accent: "#05dbd6",
    bg: "#0c1020",
  });

  it("returns a valid palette", () => {
    expectValidPalette(p);
  });

  it("card is lighter than bg", () => {
    expect(hexToHsl(p.card).l).toBeGreaterThan(hexToHsl(p.bg).l);
  });

  it("inks are light (high lightness) and ink keeps >=7 contrast vs card", () => {
    expect(hexToHsl(p.ink).l).toBeGreaterThan(50);
    expect(contrastRatio(p.ink, p.card)).toBeGreaterThanOrEqual(7.0);
    expect(contrastRatio(p.inkSoft, p.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.inkMuted, p.card)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("derivePalette — contrast guard sweep (saturated mid-luminance bgs)", () => {
  // This sweep is the regression net for the silent-contrast-failure BLOCKER:
  // saturated, mid-luminance background seeds used to yield a card that no ink
  // could reach 7:1 (ink) or 4.5:1 (inkSoft/inkMuted) against, while the guard
  // silently returned a non-conforming tinted colour. We now GUARANTEE the
  // thresholds. Build a structured grid plus the verified failing brands.
  function buildSeeds(): string[] {
    const seeds: string[] = [];
    for (let h = 0; h < 360; h += 30) {
      for (const s of [40, 70, 100]) {
        for (const l of [10, 20, 30, 40, 50]) {
          seeds.push(hslToHex(h, s, l));
        }
      }
    }
    // Specific operator-brand backgrounds confirmed to fail before the fix.
    seeds.push(
      "#15803d", // mid green   — was ink-vs-card ~3.32
      "#737300", // olive       — was ~2.86
      "#3f6212", // —           — was ~4.36
      "#9a3412", // burnt orange— was ~5.24
      "#14532d", // deep green
      "#134e4a", // deep teal
    );
    return seeds;
  }

  const seeds = buildSeeds();

  it("covers a few hundred saturated/mid-luminance seeds", () => {
    // 12 hues * 3 sats * 5 lightnesses = 180, plus 6 named brands = 186.
    expect(seeds.length).toBeGreaterThanOrEqual(180);
  });

  it("every seed clears the contrast guards and emits 11 valid tokens", () => {
    const failures: string[] = [];
    for (const bg of seeds) {
      const p = derivePalette({
        primary: DEFAULT_THEME_SEEDS.primary,
        accent: DEFAULT_THEME_SEEDS.accent,
        bg,
      });

      // All 11 tokens must be valid lowercase #rrggbb.
      for (const value of Object.values(p)) {
        if (!HEX_RE.test(value)) {
          failures.push(`${bg}: invalid token ${value}`);
        }
      }

      const inkC = contrastRatio(p.ink, p.card);
      const softC = contrastRatio(p.inkSoft, p.card);
      const mutedC = contrastRatio(p.inkMuted, p.card);
      if (inkC < 7.0) failures.push(`${bg}: ink vs card ${inkC.toFixed(2)} < 7.0`);
      if (softC < 4.5) failures.push(`${bg}: inkSoft vs card ${softC.toFixed(2)} < 4.5`);
      if (mutedC < 4.5) failures.push(`${bg}: inkMuted vs card ${mutedC.toFixed(2)} < 4.5`);
    }

    // Surface the first few offenders for a readable failure message.
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures.length).toBe(0);
  });

  it("also varies the primary seed across the same bg grid", () => {
    // The ink hue derives from primary; prove the guarantee is independent of it.
    const primaries = ["#2c5bff", "#15803d", "#9a3412", "#737300", "#000000", "#ffffff"];
    let checked = 0;
    for (const primary of primaries) {
      for (const bg of seeds) {
        const p = derivePalette({ primary, accent: primary, bg });
        expect(contrastRatio(p.ink, p.card)).toBeGreaterThanOrEqual(7.0);
        expect(contrastRatio(p.inkSoft, p.card)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.inkMuted, p.card)).toBeGreaterThanOrEqual(4.5);
        for (const value of Object.values(p)) {
          expect(value).toMatch(HEX_RE);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1000);
  });
});

describe("derivePalette — defensive fallbacks", () => {
  it("handles garbage seeds without throwing and falls back", () => {
    let p!: DerivedPalette;
    expect(() => {
      p = derivePalette({ primary: "nope", accent: "", bg: "#fff" });
    }).not.toThrow();

    expectValidPalette(p);
    // "nope" and "" are invalid -> fall back to defaults.
    expect(p.primary).toBe(DEFAULT_THEME_SEEDS.primary);
    expect(p.accent).toBe(DEFAULT_THEME_SEEDS.accent);
    // We accept 3-digit hex, so "#fff" normalises to white.
    expect(p.bg).toBe("#ffffff");
  });

  it("tolerates a fully malformed seeds object", () => {
    // @ts-expect-error — deliberately wrong shape to prove we never throw.
    const p = derivePalette({});
    expectValidPalette(p);
    expect(p.bg).toBe(DEFAULT_THEME_SEEDS.bg);
    expect(p.primary).toBe(DEFAULT_THEME_SEEDS.primary);
    expect(p.accent).toBe(DEFAULT_THEME_SEEDS.accent);
  });
});
