import { NextRequest, NextResponse } from "next/server";
import {
  brandEmailIdentity,
  contactRequestEmail,
  sendTransactionalEmail,
} from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

// Permissive shape check — a server-side mirror of the client check. Real
// deliverability is only ever proven by the email actually sending.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Where homepage "request access" enquiries land. Defaults to the public hello@
// address shown on the site so the endpoint always has a destination.
const NOTIFY_TO = process.env.CONTACT_NOTIFY_EMAIL ?? "hello@talentstream.co.za";

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0]!.trim() : "unknown";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Please try again." },
      { status: 400 }
    );
  }

  const { email, company } = (body ?? {}) as {
    email?: unknown;
    company?: unknown;
  };

  // Honeypot: the hidden "company" field is invisible to people and only bots
  // fill it. Accept silently (so the bot sees success and doesn't retry) but
  // send nothing.
  if (typeof company === "string" && company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json(
      { error: "Please enter a valid email address, like you@company.com." },
      { status: 400 }
    );
  }

  // Blunt abuse on a single instance: 5 enquiries per IP per 10 minutes. This is
  // process-local (see rate-limit.ts) — a speed bump, not a security boundary.
  if (!rateLimit(`contact:${clientIp(request)}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a few minutes." },
      { status: 429 }
    );
  }

  const normalized = email.trim().toLowerCase();
  const submittedAt = new Date().toLocaleString("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Notify the team, with Reply-To set to the enquirer so they can respond
  // directly. brandEmailIdentity keeps the verified envelope-from intact.
  const id = await sendTransactionalEmail(
    NOTIFY_TO,
    `New campaign enquiry — ${normalized}`,
    contactRequestEmail(normalized, submittedAt),
    brandEmailIdentity({ reply_to_email: normalized })
  );

  if (!id) {
    return NextResponse.json(
      {
        error:
          "We couldn't send your request just now. Please email hello@talentstream.co.za and we'll take it from there.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
