"use client";

import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import type { UIMessage } from "ai";

/* ── Types ─────────────────────────────────────────────────────────── */

interface BrandColours {
  primary: string;
  secondary: string;
  accent: string | null;
  text: string;
}

interface Props {
  conversationId: string | null;
  chatToken: string;
  roleTitle: string;
  roleDescriptionHtml: string;
  companyName: string;
  location: string | null;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  logoUrl: string | null;
  brandColours: BrandColours;
}

/* ── Colour helpers ─────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastText(bg: string): string {
  return luminance(bg) > 0.55 ? "#11123c" : "#fafaf7";
}

/** Mix a colour toward white by a fraction (0–1) */
function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) =>
    Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

/** Derive a full palette from brand colours */
function buildPalette(brand: BrandColours) {
  const p = brand.primary;
  const isLightPrimary = luminance(p) > 0.55;
  return {
    // Page & surface
    pageBg: brand.secondary,
    surfaceBg: "#ffffff",
    // Primary shades
    primary: p,
    primaryText: contrastText(p),
    primaryTint: tint(p, 0.92), // very light wash for backgrounds
    primaryMid: tint(p, 0.8), // for borders on bot bubbles
    primarySoft: tint(p, 0.6), // for muted accents
    // Text hierarchy using brand text colour
    textStrong: brand.text,
    textBody: tint(brand.text, 0.2),
    textMuted: tint(brand.text, 0.5),
    textFaint: tint(brand.text, 0.65),
    // Borders derived from secondary
    border: isLightPrimary ? tint(brand.text, 0.82) : tint(p, 0.82),
    borderLight: isLightPrimary ? tint(brand.text, 0.88) : tint(p, 0.88),
    // Bot bubble — white with subtle border
    botBubbleBg: "#ffffff",
    botBubbleBorder: isLightPrimary ? tint(brand.text, 0.85) : tint(p, 0.85),
    // Spinner
    spinnerTrack: tint(p, 0.85),
    spinnerHead: p,
  };
}

function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/* ── Component ──────────────────────────────────────────────────────── */

export function ChatInterface({
  conversationId,
  chatToken,
  roleTitle,
  roleDescriptionHtml,
  companyName,
  location,
  employmentType,
  salaryMin,
  salaryMax,
  logoUrl,
  brandColours,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [convStatus, setConvStatus] = useState<
    "active" | "dormant" | "closed"
  >("active");
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);

  const c = useMemo(() => buildPalette(brandColours), [brandColours]);

  const { messages, setMessages, sendMessage, status, error } = useChat({
    transport: new TextStreamChatTransport({
      api: conversationId ? `/api/chat/${conversationId}` : "/api/chat/noop",
      headers: { "x-chat-token": chatToken },
    }),
  });

  const isStreaming = status === "streaming" || status === "submitted";

  /* ── Load existing messages on mount ──────────────────────────────── */

  useEffect(() => {
    if (!conversationId) {
      setInitialLoading(false);
      return;
    }

    async function loadExisting() {
      try {
        const res = await fetch(
          `/api/chat/${conversationId}/messages?since=${new Date(0).toISOString()}`,
          { headers: { "x-chat-token": chatToken } }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.status) setConvStatus(data.status);
          if (data.messages?.length > 0) {
            const uiMessages: UIMessage[] = data.messages.map(
              (m: { id: string; role: string; content: string; created_at: string }) => ({
                id: m.id,
                role: m.role as "user" | "assistant" | "system",
                parts: [{ type: "text" as const, text: m.content }],
              })
            );
            setMessages(uiMessages);
          }
        }
      } catch {
        /* silent */
      } finally {
        setInitialLoading(false);
      }
    }

    loadExisting();
  }, [conversationId, chatToken, setMessages]);

  /* ── Auto-scroll ──────────────────────────────────────────────────── */

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages, isStreaming]);

  /* ── Poll for conversation status changes ───────────────────────────── */

  useEffect(() => {
    if (!conversationId || initialLoading) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/chat/${conversationId}/messages?since=${encodeURIComponent(new Date().toISOString())}`,
          { headers: { "x-chat-token": chatToken } }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.status && data.status !== convStatus) {
            setConvStatus(data.status);
          }
        }
      } catch {
        /* silent */
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [conversationId, chatToken, convStatus, initialLoading]);

  /* ── Textarea auto-resize ─────────────────────────────────────────── */

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, []);

  useEffect(resizeTextarea, [inputValue, resizeTextarea]);

  /* ── Send message ─────────────────────────────────────────────────── */

  function send() {
    const text = inputValue.trim();
    if (!text || isStreaming || convStatus === "closed") return;
    setInputValue("");
    sendMessage({ text });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isClosed = convStatus === "closed";

  /* ── Brand logo or company name fallback ──────────────────────────── */

  const brandBadge = logoUrl ? (
    <img src={logoUrl} alt={companyName} className="h-8 max-w-[140px] object-contain" />
  ) : (
    <span className="text-sm font-semibold" style={{ color: c.textStrong }}>
      {companyName}
    </span>
  );

  const brandBadgeSm = logoUrl ? (
    <img src={logoUrl} alt={companyName} className="h-6 max-w-[100px] object-contain" />
  ) : (
    <span className="text-xs font-semibold" style={{ color: c.textStrong }}>
      {companyName}
    </span>
  );

  /* ── No conversation state ────────────────────────────────────────── */

  if (!conversationId) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: c.pageBg }}
      >
        <div className="mx-auto max-w-md px-6 text-center">
          {logoUrl && (
            <div className="mb-6">
              <img src={logoUrl} alt={companyName} className="mx-auto h-10 max-w-[180px] object-contain" />
            </div>
          )}
          <div
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: c.primaryTint }}
          >
            <svg
              width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke={c.primary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <h2
            className="font-[family-name:var(--font-fraunces)] text-xl italic"
            style={{ color: c.textStrong }}
          >
            No active conversation
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: c.textMuted }}>
            There isn't an active chat for this application yet. You'll receive
            an email when the recruitment team has follow-up questions.
          </p>
        </div>
      </div>
    );
  }

  /* ── Main chat layout ─────────────────────────────────────────────── */

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: c.pageBg }}>
      {/* ─── Desktop Sidebar ──────────────────────────────────────── */}
      <aside
        className="hidden w-72 shrink-0 flex-col bg-white lg:flex"
        style={{ borderRight: `1px solid ${c.border}` }}
      >
        {/* Brand accent stripe */}
        <div className="h-1 w-full" style={{ backgroundColor: c.primary }} />

        <div className="flex flex-1 flex-col overflow-y-auto p-6">
          <div className="mb-6">{brandBadge}</div>

          <div className="space-y-5">
            <div>
              <p
                className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em]"
                style={{ color: c.textFaint }}
              >
                Position
              </p>
              <h2
                className="font-[family-name:var(--font-fraunces)] text-lg italic leading-snug"
                style={{ color: c.textStrong }}
              >
                {roleTitle}
              </h2>
            </div>

            <div className="space-y-3 text-sm">
              <InfoRow label="Company" value={companyName} c={c} />
              {location && <InfoRow label="Location" value={location} c={c} />}
              {employmentType && <InfoRow label="Type" value={employmentType} c={c} />}
              {salaryMin && salaryMax && (
                <InfoRow
                  label="Salary"
                  value={`R${salaryMin.toLocaleString()} – R${salaryMax.toLocaleString()}`}
                  c={c}
                />
              )}
            </div>

            {roleDescriptionHtml && (
              <div className="pt-4" style={{ borderTop: `1px solid ${c.border}` }}>
                <p
                  className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: c.textFaint }}
                >
                  About the role
                </p>
                <div
                  className="prose-xs text-xs leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-2 [&_li]:mb-1 [&_strong]:font-semibold [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:mb-2 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mb-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-1"
                  style={{ color: c.textMuted }}
                  dangerouslySetInnerHTML={{ __html: roleDescriptionHtml }}
                />
              </div>
            )}
          </div>

          <div className="pt-6">
            <div
              className="rounded-xl px-4 py-3"
              style={{
                backgroundColor: c.primaryTint,
                border: `1px solid ${c.primaryMid}`,
              }}
            >
              <p className="text-[0.65rem] leading-relaxed" style={{ color: c.textMuted }}>
                This is a follow-up conversation about your application.
                Your responses help the recruitment team learn more about you.
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Main chat area ───────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header
          className="flex items-center gap-3 bg-white px-4 py-3 lg:hidden"
          style={{ borderBottom: `1px solid ${c.border}` }}
        >
          {brandBadgeSm}
          <div className="min-w-0 flex-1">
            <p
              className="truncate font-[family-name:var(--font-fraunces)] text-sm italic"
              style={{ color: c.textStrong }}
            >
              {roleTitle}
            </p>
            {logoUrl && (
              <p className="truncate text-xs" style={{ color: c.textFaint }}>
                {companyName}
              </p>
            )}
          </div>
          <button
            onClick={() => setMobileInfoOpen(!mobileInfoOpen)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={{
              border: `1px solid ${c.border}`,
              color: c.textMuted,
            }}
            aria-label="Toggle role details"
          >
            <svg
              width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M8 7v4M8 5.5v.01" />
            </svg>
          </button>
        </header>

        {mobileInfoOpen && (
          <div
            className="bg-white px-4 py-3 lg:hidden"
            style={{ borderBottom: `1px solid ${c.border}` }}
          >
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: c.textMuted }}>
              {location && <span>{location}</span>}
              {employmentType && <span>{employmentType}</span>}
              {salaryMin && salaryMax && (
                <span>R{salaryMin.toLocaleString()} – R{salaryMax.toLocaleString()}</span>
              )}
            </div>
          </div>
        )}

        {/* Desktop header */}
        <header
          className="hidden items-center bg-white px-6 py-3.5 lg:flex"
          style={{ borderBottom: `1px solid ${c.border}` }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: c.primaryTint }}
            >
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke={c.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: c.textStrong }}>
                Recruitment Assistant
              </p>
              <p className="text-xs" style={{ color: c.textFaint }}>
                {isClosed
                  ? "Conversation ended"
                  : convStatus === "dormant"
                    ? "Conversation paused"
                    : "Online"}
              </p>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto scroll-smooth"
          style={{ backgroundColor: "#f0f0f0" }}
        >
          <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
            {initialLoading && (
              <div className="flex items-center justify-center py-20">
                <div
                  className="h-6 w-6 animate-spin rounded-full border-2"
                  style={{
                    borderColor: c.spinnerTrack,
                    borderTopColor: c.spinnerHead,
                  }}
                />
              </div>
            )}

            {!initialLoading && messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt={companyName}
                    className="mx-auto mb-6 h-10 max-w-[180px] object-contain"
                  />
                )}
                <div
                  className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: c.primaryTint }}
                >
                  <svg
                    width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke={c.primary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M12 20.5c4.694 0 8.5-3.134 8.5-7s-3.806-7-8.5-7-8.5 3.134-8.5 7c0 1.527.554 2.945 1.5 4.106L3.5 20.5l3.394-1.06A10.29 10.29 0 0012 20.5z" />
                  </svg>
                </div>
                <p
                  className="font-[family-name:var(--font-fraunces)] text-lg italic"
                  style={{ color: c.textStrong }}
                >
                  Starting your conversation
                </p>
                <p className="mt-1.5 max-w-xs text-sm" style={{ color: c.textMuted }}>
                  The recruitment assistant will be with you shortly.
                </p>
              </div>
            )}

            <div className="space-y-1">
              {messages.map((msg, i) => {
                const isUser = msg.role === "user";
                const displayText = getMessageText(msg);
                const isFirst = i === 0 || messages[i - 1].role !== msg.role;

                if (!displayText) return null;

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"} ${isFirst ? "mt-4" : ""}`}
                    style={{ animation: "fadeInUp 0.3s ease-out both" }}
                  >
                    <div className="relative max-w-[85%] sm:max-w-[75%]">
                      {isFirst && (
                        <p
                          className={`mb-1 text-[0.65rem] font-medium ${isUser ? "text-right" : ""}`}
                          style={{ color: isUser ? c.textFaint : c.textMuted }}
                        >
                          {isUser ? "You" : "Recruitment Assistant"}
                        </p>
                      )}

                      <div
                        className={`px-4 py-2.5 text-[0.84rem] leading-relaxed ${
                          isUser
                            ? "rounded-2xl rounded-br-lg"
                            : "rounded-2xl rounded-bl-lg"
                        }`}
                        style={{
                          backgroundColor: "#ffffff",
                          border: `1px solid ${c.botBubbleBorder}`,
                          color: c.textBody,
                        }}
                      >
                        {displayText}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {isStreaming &&
                (messages.length === 0 ||
                  messages[messages.length - 1].role === "user") && (
                  <div className="mt-4 flex justify-start">
                    <div>
                      <p
                        className="mb-1 text-[0.65rem] font-medium"
                        style={{ color: c.textMuted }}
                      >
                        Recruitment Assistant
                      </p>
                      <div
                        className="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-lg px-5 py-3"
                        style={{
                          backgroundColor: c.botBubbleBg,
                          border: `1px solid ${c.botBubbleBorder}`,
                        }}
                      >
                        {[0, 0.2, 0.4].map((delay) => (
                          <span
                            key={delay}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              backgroundColor: c.primarySoft,
                              animation: `pulse-dot 1.4s ease-in-out ${delay}s infinite`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="border-t border-[#ffe0da] bg-[#fff5f3] px-4 py-2.5 text-center text-xs text-[#c02616]">
            Something went wrong. Please try again.
          </div>
        )}

        {/* Input area */}
        <div
          className="bg-white px-4 py-3 sm:px-6"
          style={{ borderTop: `1px solid ${c.border}` }}
        >
          <div
            className="mx-auto flex max-w-2xl items-center gap-2 rounded-xl px-3 py-2"
            style={{ border: `1px solid ${c.border}`, backgroundColor: "#ffffff" }}
          >
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                isClosed
                  ? "This conversation has ended — thank you for your time!"
                  : convStatus === "dormant"
                    ? "Type a message to resume the conversation..."
                    : "Type your message..."
              }
              disabled={isStreaming || isClosed}
              rows={1}
              className="min-h-[1.5rem] flex-1 resize-none overflow-hidden bg-transparent text-sm outline-none disabled:opacity-50"
              style={{ color: c.textStrong }}
            />
            <button
              type="button"
              onClick={send}
              disabled={!inputValue.trim() || isStreaming || isClosed}
              className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-lg transition-all disabled:opacity-30"
              style={{
                backgroundColor: brandColours.secondary,
                color: contrastText(brandColours.secondary),
              }}
              aria-label="Send message"
            >
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function InfoRow({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof buildPalette>;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs" style={{ color: c.textFaint }}>
        {label}
      </span>
      <span className="text-right text-xs font-medium" style={{ color: c.textStrong }}>
        {value}
      </span>
    </div>
  );
}
