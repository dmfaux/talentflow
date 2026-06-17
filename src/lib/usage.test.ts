import { beforeEach, describe, expect, it, vi } from "vitest";

// recordUsageEvent fire-and-forget inserts via `@/db`. Capture the mapped row
// without a database so we can assert the undefined→null + default-quantity
// mapping deterministically. The `.values()` mock pushes synchronously and
// returns a thenable so the helper's `.catch(...)` chain still resolves.
const captured = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.rows.push(v);
        return Promise.resolve();
      },
    }),
  },
}));

import { recordUsageEvent } from "@/lib/usage";
import { namespaceDedup } from "@/lib/queue/types";
import { extractUsage } from "@/lib/ai";
import { brandEmailIdentity } from "@/lib/email";

// ── Per-tenant dedup namespacing (Resolved Decision A) ──────────────

describe("namespaceDedup", () => {
  it("namespaces a raw key by org", () => {
    expect(namespaceDedup("orgA", "process-1")).toBe("orgA:process-1");
  });

  it("never collides across orgs for the same raw key", () => {
    expect(namespaceDedup("orgA", "process-1")).not.toBe(
      namespaceDedup("orgB", "process-1")
    );
  });

  it("maps a null/undefined org to the 'global' namespace", () => {
    expect(namespaceDedup(null, "process-1")).toBe("global:process-1");
    expect(namespaceDedup(undefined, "process-1")).toBe("global:process-1");
  });

  it("returns undefined when there is no raw dedup key", () => {
    expect(namespaceDedup("orgA", undefined)).toBeUndefined();
    expect(namespaceDedup("orgA", null)).toBeUndefined();
    expect(namespaceDedup("orgA", "")).toBeUndefined();
  });
});

// ── AI SDK v6 token usage extraction ────────────────────────────────

describe("extractUsage", () => {
  it("passes through reported token counts", () => {
    expect(extractUsage({ inputTokens: 120, outputTokens: 45 })).toEqual({
      inputTokens: 120,
      outputTokens: 45,
    });
  });

  it("maps undefined v6 fields to null (unknown, not zero)", () => {
    expect(extractUsage({ inputTokens: undefined, outputTokens: undefined })).toEqual({
      inputTokens: null,
      outputTokens: null,
    });
    expect(extractUsage({})).toEqual({ inputTokens: null, outputTokens: null });
  });

  it("preserves a genuine zero (distinct from unknown)", () => {
    expect(extractUsage({ inputTokens: 0, outputTokens: 0 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("handles partially-reported usage", () => {
    expect(extractUsage({ inputTokens: 10 })).toEqual({
      inputTokens: 10,
      outputTokens: null,
    });
  });
});

// ── Deliverability-safe per-brand identity (Decision D) ─────────────

describe("brandEmailIdentity", () => {
  // The verified envelope identity (global FROM) — what every brand's address
  // must remain, regardless of personalisation.
  const verified = brandEmailIdentity(null);
  const verifiedAddr = verified.from.match(/<([^>]+)>/)?.[1] ?? verified.from;

  it("falls back to the global FROM with no Reply-To for an unset brand", () => {
    expect(brandEmailIdentity(null)).toEqual({ from: verified.from, replyTo: undefined });
    expect(brandEmailIdentity({})).toEqual({ from: verified.from, replyTo: undefined });
  });

  it("personalises the display name but keeps the verified address", () => {
    const id = brandEmailIdentity({ from_name: "Acme Corp", reply_to_email: null });
    expect(id.from).toBe(`Acme Corp <${verifiedAddr}>`);
    // The brand domain must NEVER end up in the From envelope address.
    expect(id.from).not.toContain("acme.com");
    expect(id.replyTo).toBeUndefined();
  });

  it("sets Reply-To without spoofing the From address", () => {
    const id = brandEmailIdentity({ from_name: null, reply_to_email: "careers@acme.com" });
    expect(id.from).toBe(verified.from); // no from_name → global FROM
    expect(id.replyTo).toBe("careers@acme.com");
  });

  it("uses both fields when set, address still verified", () => {
    const id = brandEmailIdentity({ from_name: "Acme Corp", reply_to_email: "careers@acme.com" });
    expect(id.from).toBe(`Acme Corp <${verifiedAddr}>`);
    expect(id.replyTo).toBe("careers@acme.com");
    expect(id.from.match(/<([^>]+)>/)?.[1]).toBe(verifiedAddr);
  });

  it("treats a blank from_name as unset", () => {
    expect(brandEmailIdentity({ from_name: "   " }).from).toBe(verified.from);
  });
});

// ── recordUsageEvent mapping ────────────────────────────────────────

describe("recordUsageEvent", () => {
  beforeEach(() => {
    captured.rows = [];
  });

  it("maps omitted optional fields to null and defaults quantity to 1", () => {
    recordUsageEvent({ orgId: "o1", kind: "ai_tokens" });
    expect(captured.rows).toHaveLength(1);
    expect(captured.rows[0]).toEqual({
      org_id: "o1",
      brand_id: null,
      kind: "ai_tokens",
      provider: null,
      model: null,
      input_tokens: null,
      output_tokens: null,
      campaign_id: null,
      candidate_id: null,
      quantity: 1,
    });
  });

  it("passes through supplied fields", () => {
    recordUsageEvent({
      orgId: "o1",
      brandId: "b1",
      kind: "ai_tokens",
      provider: "anthropic",
      model: "claude",
      inputTokens: 100,
      outputTokens: 0,
      campaignId: "c1",
      candidateId: "cand1",
      quantity: 3,
    });
    expect(captured.rows[0]).toMatchObject({
      org_id: "o1",
      brand_id: "b1",
      provider: "anthropic",
      model: "claude",
      input_tokens: 100,
      output_tokens: 0, // genuine zero preserved, not nulled
      campaign_id: "c1",
      candidate_id: "cand1",
      quantity: 3,
    });
  });
});
