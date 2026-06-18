import { COOKIE_NAME } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST() {
  // Clear the session cookie and return a plain 200 — do NOT redirect. A
  // browser fetch() auto-follows redirects, so a redirect to the app host
  // (a different origin once NEXT_PUBLIC_APP_DOMAIN is set) is followed
  // cross-origin and throws "Failed to fetch". Both callers (admin sidebar,
  // operator logout) already navigate client-side via router.push("/login"),
  // and those shells only render on the app host, so the post-logout /login
  // lands on the app host either way — preserving the S12 cross-surface intent
  // without the redirect. Mirrors the login route, which also returns JSON and
  // lets the client navigate.
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
