import { ACT_AS_COOKIE } from "@/lib/auth";
import { error, requireApiOperator, success } from "@/lib/api";
import { closeOpenActAsSessions } from "@/lib/operator-audit";
import { NextRequest } from "next/server";

// POST /api/operator/impersonate/exit — end the act-as session.
//
// Clears the cookie (so the next request resolves effectiveOrgId = null →
// deny-by-default) and closes the open impersonate audit row by stamping
// ended_at. The session's ended_at IS the exit record (no sliding renewal:
// to continue, the operator re-impersonates, which audits afresh).
export async function POST(_request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    await closeOpenActAsSessions(ctx.userId);

    const res = success({ exited: true });
    res.cookies.set(ACT_AS_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err) {
    console.error("POST /api/operator/impersonate/exit error:", err);
    return error("Internal server error", 500);
  }
}
