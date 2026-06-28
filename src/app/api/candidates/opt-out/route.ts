import { db } from "@/db";
import { candidates } from "@/db/schema";
import { hashChatToken } from "@/lib/chat-auth";
import { recordOptOut } from "@/lib/manual-candidate";
import { purgeCandidateData } from "@/lib/popia";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// Candidate opt-out (POPIA objection) for recruiter-added candidates. The
// "you've been added" notice carries `…/opt-out?t=<chat token>`. A GET (the
// email click, also hit by mail-scanner prefetch) only renders a confirmation
// page — the actual withdrawal + data purge happens on the POST, so a prefetch
// can never silently erase a candidate.

function page(title: string, bodyHtml: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.5; color: #1a1a1a;">
${bodyHtml}
</body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function resolveByToken(token: string | null) {
  if (!token) return null;
  return db.query.candidates.findFirst({
    where: eq(candidates.chat_token_hash, hashChatToken(token)),
    columns: { id: true, org_id: true, status: true, purged_at: true },
  });
}

const INVALID = page(
  "Link not recognised",
  `<h1>This link is no longer valid</h1>
   <p>The opt-out link has expired or has already been used. If you believe this
   is an error, please reply to the email you received.</p>`,
  410
);

const DONE = page(
  "You've been removed",
  `<h1>You've been removed</h1>
   <p>Your details have been withdrawn from this hiring process and your personal
   information has been scheduled for deletion. You won't receive further
   messages about this role.</p>`
);

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  const candidate = await resolveByToken(token);
  if (!candidate) return INVALID;
  if (candidate.status === "withdrawn" || candidate.purged_at) return DONE;

  // A confirmation step — the mutation lives on the POST below, so an email
  // client prefetching this URL cannot withdraw the candidate.
  return page(
    "Confirm removal",
    `<h1>Remove yourself from this process?</h1>
     <p>This withdraws your application and permanently deletes your personal
     information. This cannot be undone.</p>
     <form method="POST" action="/api/candidates/opt-out">
       <input type="hidden" name="t" value="${token}">
       <button type="submit" style="background:#b00020;color:#fff;border:0;border-radius:8px;padding:0.75rem 1.25rem;font-size:1rem;cursor:pointer;">
         Confirm &amp; delete my information
       </button>
     </form>`
  );
}

export async function POST(request: NextRequest) {
  let token: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const form = await request.formData();
    token = (form.get("t") as string) || null;
  } else {
    token = request.nextUrl.searchParams.get("t");
  }

  const candidate = await resolveByToken(token);
  if (!candidate) return INVALID;
  if (candidate.status === "withdrawn" || candidate.purged_at) return DONE;

  // Audit the objection (no PII) BEFORE the purge nulls the row's PII, then
  // withdraw + purge. purgeCandidateData also drops the chat token, so the
  // opt-out link can't be replayed.
  await recordOptOut({
    orgId: candidate.org_id,
    candidateId: candidate.id,
    fromStatus: candidate.status,
  });
  await db
    .update(candidates)
    .set({ status: "withdrawn", data_purge_at: new Date(), updated_at: new Date() })
    .where(eq(candidates.id, candidate.id));
  await purgeCandidateData(candidate.id);

  return DONE;
}
