import { db } from "@/db";
import { clients, users } from "@/db/schema";
import {
  authorizeApiBrand,
  error,
  getApiTenant,
  success,
} from "@/lib/api";
import {
  brandEmailIdentity,
  applicationReceivedEmail,
  resolveEmailSubject,
  sendTransactionalEmail,
} from "@/lib/email";
import { assertThemeAvailableForBrand, resolveCampaignTheme } from "@/lib/theme";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// ── CT3 · Themed sample email — test-send + live preview ────────────
//
// Backs the wizard's theme picker. This MUST be a server endpoint: src/lib/email
// imports @/db at module scope, so its template functions can't be bundled into a
// client component. Two modes on one route:
//   • default  → sends a sample applicationReceivedEmail, themed to the chosen
//                theme, to the AUTHENTICATED user's OWN address (never anyone
//                else's) via sendTransactionalEmail. Deliberately NOT metered —
//                sendTransactionalEmail records no email_sent usage event (only
//                sendCandidateEmail does), so a test-send never inflates the bill.
//   • ?preview=1 → returns the rendered HTML without sending; the wizard drops it
//                into an <iframe srcDoc> for the live preview.
//
// The chosen theme is validated against the brand's availability before it is
// resolved, so a crafted theme_id can never render another brand's bespoke look.

const SAMPLE_ROLE = "Senior Product Designer";

// Light per-user throttle so the send button can't be turned into a spam vector.
// In-memory + best-effort (a cold instance resets it) — sufficient for a
// self-only test send, and it never gates the read-only preview.
const SENDS_PER_WINDOW = 5;
const WINDOW_MS = 60_000;
const sendLog = new Map<string, number[]>();
function throttled(userId: string, now: number): boolean {
  const recent = (sendLog.get(userId) ?? []).filter((t) => t > now - WINDOW_MS);
  if (recent.length >= SENDS_PER_WINDOW) {
    sendLog.set(userId, recent);
    return true;
  }
  recent.push(now);
  sendLog.set(userId, recent);
  return false;
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const preview = request.nextUrl.searchParams.get("preview") === "1";
    const body = await request.json().catch(() => ({}));

    // Brand: the active brand by default; an explicit brand_id (gated) lets the
    // edit-mode wizard preview against the campaign's own brand.
    const requested: string | null =
      typeof body.brand_id === "string" && body.brand_id.trim()
        ? body.brand_id.trim()
        : null;
    if (requested) {
      const denied = await authorizeApiBrand(ctx, requested, "viewer");
      if (denied) return denied;
    }
    const brandId = requested ?? ctx.activeBrandId;
    if (!brandId) return error("Select a brand first", 400);

    const brand = await db.query.clients.findFirst({
      where: and(eq(clients.id, brandId), eq(clients.org_id, ctx.effectiveOrgId!)),
      columns: {
        id: true,
        org_id: true,
        name: true,
        from_name: true,
        reply_to_email: true,
        default_theme_id: true,
        branding_logo_url: true,
        logo_background: true,
        logo_position: true,
      },
    });
    if (!brand) return error("Brand not found", 404);

    // A chosen theme must be available to the brand; null inherits the brand
    // default (the resolver supplies the fallback). Validating before resolving
    // is what prevents a crafted id from rendering a foreign theme.
    let themeId: string | null = null;
    if (body.theme_id != null) {
      if (typeof body.theme_id !== "string" || !body.theme_id.trim()) {
        return error("theme_id must be a theme id or null");
      }
      const trimmed: string = body.theme_id.trim();
      const verdict = await assertThemeAvailableForBrand(trimmed, {
        id: brand.id,
        org_id: brand.org_id,
      });
      if (verdict) return error(verdict.message, verdict.status);
      themeId = trimmed;
    }

    const { email } = await resolveCampaignTheme({ theme_id: themeId, client: brand });

    const user = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { email: true, first_name: true },
    });
    if (!user) return error("User not found", 404);

    const html = applicationReceivedEmail(
      email,
      user.first_name,
      SAMPLE_ROLE,
      brand.name
    );

    if (preview) return success({ html });

    if (throttled(ctx.userId, Date.now())) {
      return error("Too many test emails — try again in a minute", 429);
    }

    // CT7: subject is themed via the resolved theme's per-type subject override
    // (resolveEmailSubject), so the test send matches what a candidate receives;
    // kept under a [Test] prefix so it is unmistakably a self-send sample.
    const themedSubject = resolveEmailSubject(email, "applicationReceived", {
      candidate: { name: user.first_name },
      campaign: { role_title: SAMPLE_ROLE },
      client: { name: brand.name },
    });
    const id = await sendTransactionalEmail(
      user.email,
      `[Test] ${themedSubject}`,
      html,
      brandEmailIdentity(brand)
    );
    if (!id) return error("Failed to send the test email", 502);

    return success({ sent: true, to: user.email });
  } catch (err) {
    console.error("POST /api/admin/themes/test-send error:", err);
    return error("Internal server error", 500);
  }
}
