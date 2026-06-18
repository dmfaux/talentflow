import { COOKIE_NAME } from "@/lib/auth";
import { appHostOrigin } from "@/lib/host";
import { NextResponse } from "next/server";

export async function POST() {
  // Login lives on the app host (S12), so log out back to app.{domain}/login —
  // not the apex — so the cleared cookie and the next sign-in share a host.
  const response = NextResponse.redirect(new URL("/login", appHostOrigin()));
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
