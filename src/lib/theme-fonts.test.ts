import { describe, expect, it } from "vitest";

import {
  BODY_FONTS,
  DEFAULT_BODY_FONT_KEY,
  DEFAULT_DISPLAY_FONT_KEY,
  DISPLAY_FONTS,
  type FontDef,
  fontImportsFor,
  resolveBodyFont,
  resolveDisplayFont,
} from "./theme-fonts";

const EXACT_DISPLAY_STACK =
  "'Instrument Serif', Georgia, 'Times New Roman', 'DejaVu Serif', serif";
const EXACT_BODY_STACK =
  "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const EXACT_DISPLAY_IMPORT =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap";
const EXACT_BODY_IMPORT =
  "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap";

describe("default fonts preserve today's look byte-for-byte", () => {
  it("default display font has the exact stack and importUrl", () => {
    const def = DISPLAY_FONTS.find((f) => f.key === DEFAULT_DISPLAY_FONT_KEY);
    expect(def).toBeDefined();
    expect(def!.key).toBe("instrument-serif");
    expect(def!.stack).toBe(EXACT_DISPLAY_STACK);
    expect(def!.importUrl).toBe(EXACT_DISPLAY_IMPORT);
  });

  it("default body font has the exact stack and importUrl", () => {
    const def = BODY_FONTS.find((f) => f.key === DEFAULT_BODY_FONT_KEY);
    expect(def).toBeDefined();
    expect(def!.key).toBe("instrument-sans");
    expect(def!.stack).toBe(EXACT_BODY_STACK);
    expect(def!.importUrl).toBe(EXACT_BODY_IMPORT);
  });

  it("default keys are the documented constants", () => {
    expect(DEFAULT_DISPLAY_FONT_KEY).toBe("instrument-serif");
    expect(DEFAULT_BODY_FONT_KEY).toBe("instrument-sans");
  });
});

describe("resolveDisplayFont / resolveBodyFont", () => {
  it("falls back to the default display font for null/unknown keys", () => {
    expect(resolveDisplayFont(null).key).toBe(DEFAULT_DISPLAY_FONT_KEY);
    expect(resolveDisplayFont(undefined).key).toBe(DEFAULT_DISPLAY_FONT_KEY);
    expect(resolveDisplayFont("nonexistent").key).toBe(DEFAULT_DISPLAY_FONT_KEY);
    expect(resolveDisplayFont("").key).toBe(DEFAULT_DISPLAY_FONT_KEY);
  });

  it("falls back to the default body font for null/unknown keys", () => {
    expect(resolveBodyFont(null).key).toBe(DEFAULT_BODY_FONT_KEY);
    expect(resolveBodyFont(undefined).key).toBe(DEFAULT_BODY_FONT_KEY);
    expect(resolveBodyFont("nonexistent").key).toBe(DEFAULT_BODY_FONT_KEY);
    expect(resolveBodyFont("").key).toBe(DEFAULT_BODY_FONT_KEY);
  });

  it("resolves a known display key (fraunces) to its def", () => {
    const def = resolveDisplayFont("fraunces");
    expect(def.key).toBe("fraunces");
    expect(def.label).toBe("Fraunces");
    expect(def.role).toBe("display");
  });

  it("does not resolve a body key as a display font", () => {
    // "inter" is a body font; resolving it as a display font must fall back.
    expect(resolveDisplayFont("inter").key).toBe(DEFAULT_DISPLAY_FONT_KEY);
    // ...and vice-versa.
    expect(resolveBodyFont("fraunces").key).toBe(DEFAULT_BODY_FONT_KEY);
  });
});

describe("catalogue integrity", () => {
  const all: FontDef[] = [...DISPLAY_FONTS, ...BODY_FONTS];

  it("every def has a non-empty stack", () => {
    for (const f of all) {
      expect(f.stack, `stack for ${f.key}`).toBeTruthy();
      expect(f.stack.trim().length).toBeGreaterThan(0);
    }
  });

  it("every key is kebab-case", () => {
    for (const f of all) {
      expect(f.key, `key ${f.key}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("keys are unique across BOTH lists", () => {
    const keys = all.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("each list carries the correct role", () => {
    for (const f of DISPLAY_FONTS) expect(f.role).toBe("display");
    for (const f of BODY_FONTS) expect(f.role).toBe("body");
  });

  it("importUrl is null or a Google Fonts URL", () => {
    for (const f of all) {
      if (f.importUrl !== null) {
        expect(f.importUrl, `importUrl for ${f.key}`).toMatch(
          /^https:\/\/fonts\.googleapis\.com\//,
        );
      }
    }
  });
});

describe("fontImportsFor", () => {
  it("returns [display URL, body URL] in order for the defaults", () => {
    expect(fontImportsFor(DEFAULT_DISPLAY_FONT_KEY, DEFAULT_BODY_FONT_KEY)).toEqual([
      EXACT_DISPLAY_IMPORT,
      EXACT_BODY_IMPORT,
    ]);
  });

  it("omits the null URL when one font is the pure system stack", () => {
    const result = fontImportsFor(DEFAULT_DISPLAY_FONT_KEY, "system-sans");
    expect(result).toEqual([EXACT_DISPLAY_IMPORT]);
    expect(result).not.toContain(null);
  });

  it("never emits duplicate URLs", () => {
    // General invariant across the curated catalogue: distinct fonts never
    // share a Google Fonts URL, so any pair yields a duplicate-free list.
    for (const d of DISPLAY_FONTS) {
      for (const b of BODY_FONTS) {
        const result = fontImportsFor(d.key, b.key);
        expect(new Set(result).size, `${d.key}+${b.key}`).toBe(result.length);
      }
    }
  });

  it("collapses to a single entry when both resolved fonts share one URL", () => {
    // The curated catalogue deliberately never shares a URL across roles. To
    // exercise the real dedup branch in fontImportsFor, monkeypatch one body
    // font's importUrl to match the default display font's URL for this test,
    // then restore it. This drives the actual function, not a reimplementation.
    const body = BODY_FONTS.find((f) => f.key === "inter")!;
    const original = body.importUrl;
    try {
      (body as { importUrl: string | null }).importUrl = EXACT_DISPLAY_IMPORT;
      const result = fontImportsFor(DEFAULT_DISPLAY_FONT_KEY, "inter");
      expect(result).toEqual([EXACT_DISPLAY_IMPORT]);
    } finally {
      (body as { importUrl: string | null }).importUrl = original;
    }
  });
});
