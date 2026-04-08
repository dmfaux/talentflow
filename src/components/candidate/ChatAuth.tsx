"use client";

import { useState, type FormEvent } from "react";

interface BrandColours {
  primary: string;
  secondary: string;
  accent: string | null;
  text: string;
}

interface Props {
  clientSlug: string;
  campaignSlug: string;
  roleTitle: string;
  companyName: string;
  logoUrl: string | null;
  brandColours: BrandColours;
  onSuccess: (token: string) => void;
}

function contrastText(bg: string): string {
  const hex = bg.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#11123c" : "#fafaf7";
}

export function ChatAuth({
  clientSlug,
  campaignSlug,
  roleTitle,
  companyName,
  logoUrl,
  brandColours,
}: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, clientSlug, campaignSlug }),
      });

      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }

      setSent(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const primaryBg = brandColours.primary;
  const primaryText = contrastText(primaryBg);
  const textColor = brandColours.text;

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: brandColours.secondary }}
    >
      <div className="w-full max-w-md">
        <div className="rounded-2xl border bg-white p-8 shadow-sm" style={{ borderColor: `${textColor}18` }}>
          {logoUrl ? (
            <div className="mb-6 flex justify-center">
              <img
                src={logoUrl}
                alt={companyName}
                className="h-10 max-w-[160px] object-contain"
              />
            </div>
          ) : (
            <div className="mb-6 text-center">
              <span className="text-base font-semibold" style={{ color: textColor }}>
                {companyName}
              </span>
            </div>
          )}

          <h1
            className="text-center font-serif text-xl italic"
            style={{ color: textColor }}
          >
            Verify your identity
          </h1>
          <p className="mt-2 text-center text-sm leading-relaxed" style={{ color: `${textColor}99` }}>
            Enter the email you used to apply for the{" "}
            <span className="font-medium" style={{ color: textColor }}>
              {roleTitle}
            </span>{" "}
            position
            {logoUrl ? (
              <>
                {" "}at{" "}
                <span className="font-medium" style={{ color: textColor }}>
                  {companyName}
                </span>
              </>
            ) : null}{" "}
            and we'll send you a verification link.
          </p>

          {sent ? (
            <div
              className="mt-6 rounded-xl px-5 py-4 text-center"
              style={{
                backgroundColor: `${primaryBg}12`,
                border: `1px solid ${primaryBg}30`,
              }}
            >
              <p className="text-sm font-medium" style={{ color: primaryBg }}>
                Check your email
              </p>
              <p className="mt-1 text-xs" style={{ color: `${textColor}88` }}>
                We've sent a verification link to{" "}
                <span className="font-medium">{email}</span>. Click the link to
                continue your chat. The link expires in 1 hour.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="chat-email"
                  className="mb-1.5 block text-xs font-medium"
                  style={{ color: `${textColor}cc` }}
                >
                  Email address
                </label>
                <input
                  id="chat-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg bg-white px-3.5 py-2.5 text-sm outline-none transition-colors"
                  style={{
                    border: `1px solid ${textColor}22`,
                    color: textColor,
                  }}
                />
              </div>

              {error && (
                <p className="text-xs text-[#dc2626]">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-60"
                style={{
                  backgroundColor: primaryBg,
                  color: primaryText,
                }}
              >
                {loading ? "Sending..." : "Send verification link"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
