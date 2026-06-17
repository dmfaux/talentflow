import { db } from "@/db";
import { campaigns, clients, events } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_EVENT_TYPES = new Set([
  "page_view",
  "form_start",
  "field_interact",
  "form_submit",
  "form_abandon",
]);

function parseUserAgent(ua: string): { browser: string; device_type: string } {
  const isMobile = /Mobile|Android.*Mobile|iPhone|iPod/i.test(ua);
  const isTablet = /Tablet|iPad|Android(?!.*Mobile)/i.test(ua);
  const device_type = isMobile ? "mobile" : isTablet ? "tablet" : "desktop";

  let browser = "other";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = "Opera";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua)) browser = "Safari";

  return { browser, device_type };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { client_slug, campaign_slug, session_id, visitor_id } = body;
    if (!client_slug || !campaign_slug || !session_id) {
      return NextResponse.json(
        { error: "client_slug, campaign_slug, and session_id are required" },
        { status: 400 },
      );
    }

    const eventList = body.events;
    if (!Array.isArray(eventList) || eventList.length === 0) {
      return NextResponse.json(
        { error: "events must be a non-empty array" },
        { status: 400 },
      );
    }

    // Filter to valid event types
    const validEvents = eventList.filter(
      (e: { type?: string }) => e.type && ALLOWED_EVENT_TYPES.has(e.type),
    );
    if (validEvents.length === 0) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // Resolve campaign_id from slugs
    const [campaign] = await db
      .select({ id: campaigns.id, org_id: campaigns.org_id })
      .from(campaigns)
      .innerJoin(clients, eq(campaigns.client_id, clients.id))
      .where(and(eq(clients.slug, client_slug), eq(campaigns.slug, campaign_slug)))
      .limit(1);

    if (!campaign) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // Parse User-Agent
    const ua = request.headers.get("user-agent") ?? "";
    const { browser, device_type } = parseUserAgent(ua);

    // Batch insert
    await db.insert(events).values(
      validEvents.map((e: { type: string; metadata?: Record<string, unknown> }) => ({
        // Public write: stamp org_id explicitly from the resolved campaign.
        org_id: campaign.org_id,
        campaign_id: campaign.id,
        event_type: e.type,
        session_id: String(session_id),
        visitor_id: visitor_id ? String(visitor_id) : null,
        device_type,
        browser,
        metadata: e.metadata ?? null,
      })),
    );

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: true }, { status: 202 });
  }
}
