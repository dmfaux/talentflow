import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// S14 terminology guard: the files renamed in the "Client(s) → Brand(s)" pass
// must contain no lingering USER-VISIBLE "Client" string. Code identifiers
// (client_id, clientSlug, the /clients route segment, the `Client` TS type,
// the `clients` array, etc.) deliberately stay — only rendered copy was renamed
// — so this scans JSX text nodes and visible string/attribute copy, not the
// whole file.

const TARGET_FILES = [
  "src/app/(admin)/clients/[id]/page.tsx",
  "src/app/(admin)/clients/new/page.tsx",
  "src/app/(admin)/campaigns/page.tsx",
  "src/app/(admin)/users/[id]/page.tsx",
  "src/components/admin/branding-section.tsx",
  "src/components/admin/campaign-wizard.tsx",
  "src/components/admin/live-campaign-preview.tsx",
];

/** Return the user-visible "Client" offences in one source file (line: text). */
function findVisibleClient(src: string): string[] {
  const offenders: string[] = [];
  src.split("\n").forEach((line, idx) => {
    const flag = () => offenders.push(`${idx + 1}: ${line.trim()}`);

    // 1. JSX text nodes — content between a `>` and the next `<` with no braces
    //    (so JS expressions like {clients.length} are excluded). Catches
    //    breadcrumbs, labels, headings, <option>s and helper <p> copy.
    for (const m of line.matchAll(/>([^<>{}]+)</g)) {
      if (/\bclients?\b/i.test(m[1])) return flag();
    }
    // 2. Capitalised "Client" inside a quoted string — visible labels, error
    //    messages and fallbacks (the lowercase `"use client"` directive and
    //    `/clients` API paths never match a capital C).
    for (const m of line.matchAll(/(["'])((?:(?!\1).)*)\1/g)) {
      if (/\bClients?\b/.test(m[2])) return flag();
    }
    // 3. Visible attribute copy (placeholders / titles / aria-labels), lowercase too.
    for (const m of line.matchAll(/(?:placeholder|title|aria-label)=(["'])((?:(?!\1).)*)\1/g)) {
      if (/\bclients?\b/i.test(m[2])) return flag();
    }
  });
  return [...new Set(offenders)];
}

describe("S14 terminology rename (Client → Brand)", () => {
  it.each(TARGET_FILES)("%s has no user-visible 'Client' copy", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    const offenders = findVisibleClient(src);
    expect(offenders, `Visible "Client" copy still present in ${rel}:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the scanner actually detects a visible 'Client' string (self-check)", () => {
    expect(findVisibleClient(`<span>All clients</span>`)).toHaveLength(1);
    expect(findVisibleClient(`const x = "Client not found";`)).toHaveLength(1);
    expect(findVisibleClient(`placeholder="Search role, client, location"`)).toHaveLength(1);
    // Must NOT flag legitimate code identifiers / the directive.
    expect(findVisibleClient(`"use client";`)).toHaveLength(0);
    expect(findVisibleClient(`const id = client_id; fetch("/api/admin/clients/" + id);`)).toHaveLength(0);
    expect(findVisibleClient(`{clients.map((c) => c.name)}`)).toHaveLength(0);
  });
});
