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
import { marked } from "marked";

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
  const sidebarBase = isLightPrimary ? brand.text : p;
  const sidebarIsDark = luminance(sidebarBase) <= 0.55;

  return {
    // Page & surface
    pageBg: brand.secondary,
    surfaceBg: "#ffffff",
    // Primary shades
    primary: p,
    primaryText: contrastText(p),
    primaryTint: tint(p, 0.92),
    primaryMid: tint(p, 0.8),
    primarySoft: tint(p, 0.6),
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

    // ── Sidebar panel ──
    sidebarFrom: sidebarBase,
    sidebarTo: tint(sidebarBase, 0.1),
    sidebarText: sidebarIsDark ? "#ffffff" : "#11123c",
    sidebarTextSoft: sidebarIsDark
      ? "rgba(255,255,255,0.72)"
      : "rgba(17,18,60,0.6)",
    sidebarTextFaint: sidebarIsDark
      ? "rgba(255,255,255,0.4)"
      : "rgba(17,18,60,0.35)",
    sidebarDivider: sidebarIsDark
      ? "rgba(255,255,255,0.1)"
      : "rgba(17,18,60,0.1)",
    sidebarGlow: tint(p, sidebarIsDark ? 0.4 : 0.15),

    // ── User messages ──
    userBubbleBg: p,
    userBubbleText: contrastText(p),

    // ── Chat area ──
    chatBg: tint(sidebarBase, 0.965),
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

  /* ── Status helpers ─────────────────────────────────────────────────── */

  const statusDotColor =
    isClosed ? "#999" : convStatus === "dormant" ? "#d68a0b" : "#0a8a5a";
  const statusLabel =
    isClosed
      ? "Conversation ended"
      : convStatus === "dormant"
        ? "Paused"
        : "Online";

  /* ── No conversation state ────────────────────────────────────────── */

  if (!conversationId) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden"
        style={{ backgroundColor: c.chatBg }}
      >
        <div className="paper-grid pointer-events-none absolute inset-0 opacity-40" />
        <div
          className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
          style={{ backgroundColor: c.primaryTint, opacity: 0.6 }}
        />

        <div
          className="relative z-10 mx-auto max-w-md px-6 text-center"
          style={{ animation: "fadeInUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both" }}
        >
          {logoUrl && (
            <div className="mb-8">
              <img
                src={logoUrl}
                alt={companyName}
                className="mx-auto h-10 max-w-[180px] object-contain"
              />
            </div>
          )}
          <div
            className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl"
            style={{ backgroundColor: c.primaryTint }}
          >
            <svg
              width="32" height="32" viewBox="0 0 24 24" fill="none"
              stroke={c.primary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <div
              className="absolute -right-1 -top-1 h-4 w-4 rounded-full"
              style={{
                backgroundColor: c.primary,
                animation: "pulse-subtle 2s ease-in-out infinite",
              }}
            />
          </div>
          <h2
            className="font-display-italic text-2xl"
            style={{ color: c.textStrong }}
          >
            No active conversation
          </h2>
          <p
            className="mt-3 text-sm leading-relaxed"
            style={{ color: c.textMuted }}
          >
            There isn&apos;t an active chat for this application yet. You&apos;ll
            receive an email when the recruitment team has follow-up questions.
          </p>
        </div>
      </div>
    );
  }

  /* ── Main chat layout ─────────────────────────────────────────────── */

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* ─── Rich Branded Sidebar ────────────────────────────────── */}
      <aside
        className="relative hidden w-[300px] shrink-0 flex-col overflow-hidden lg:flex"
        style={{
          background: `linear-gradient(165deg, ${c.sidebarFrom} 0%, ${c.sidebarTo} 100%)`,
        }}
      >
        {/* Decorative glow blobs */}
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
          style={{
            backgroundColor: c.sidebarGlow,
            opacity: 0.08,
            filter: "blur(60px)",
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full"
          style={{
            backgroundColor: c.sidebarGlow,
            opacity: 0.05,
            filter: "blur(40px)",
          }}
        />

        <div className="relative z-10 flex flex-1 flex-col overflow-y-auto p-7">
          {/* Brand badge */}
          <div className="mb-8">
            {logoUrl ? (
              <div
                className="inline-flex items-center rounded-xl px-3 py-2"
                style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
              >
                <img
                  src={logoUrl}
                  alt={companyName}
                  className="h-8 max-w-[140px] object-contain"
                />
              </div>
            ) : (
              <span
                className="text-lg font-semibold"
                style={{ color: c.sidebarText }}
              >
                {companyName}
              </span>
            )}
          </div>

          {/* Role title */}
          <div className="mb-6">
            <p className="eyebrow mb-2" style={{ color: c.sidebarTextFaint }}>
              Position
            </p>
            <h2
              className="font-display-italic text-[1.4rem] leading-snug"
              style={{ color: c.sidebarText }}
            >
              {roleTitle}
            </h2>
          </div>

          {/* Metadata rows */}
          <div className="space-y-2.5 text-sm">
            <SidebarRow label="Company" value={companyName} c={c} />
            {location && <SidebarRow label="Location" value={location} c={c} />}
            {employmentType && (
              <SidebarRow label="Type" value={employmentType} c={c} />
            )}
            {salaryMin && salaryMax && (
              <SidebarRow
                label="Salary"
                value={`R${salaryMin.toLocaleString()} – R${salaryMax.toLocaleString()}`}
                c={c}
              />
            )}
          </div>

          {/* Role description */}
          {roleDescriptionHtml && (
            <>
              <div
                className="my-5 h-px w-full"
                style={{ backgroundColor: c.sidebarDivider }}
              />
              <div className="flex-1 overflow-y-auto">
                <p
                  className="eyebrow mb-2"
                  style={{ color: c.sidebarTextFaint }}
                >
                  About the role
                </p>
                <div
                  className="text-[0.78rem] leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-2 [&_li]:mb-1 [&_strong]:font-semibold [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:mb-2 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mb-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-1"
                  style={{ color: c.sidebarTextSoft }}
                  dangerouslySetInnerHTML={{ __html: roleDescriptionHtml }}
                />
              </div>
            </>
          )}

          {/* Context note */}
          <div className="mt-auto pt-6">
            <div
              className="rounded-xl px-4 py-3"
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                border: `1px solid ${c.sidebarDivider}`,
              }}
            >
              <p
                className="text-[0.68rem] leading-relaxed"
                style={{ color: c.sidebarTextFaint }}
              >
                This is a follow-up conversation about your application. Your
                responses help the recruitment team learn more about you.
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Main chat area ───────────────────────────────────────── */}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: c.chatBg }}
      >
        {/* Mobile header — frosted glass */}
        <header
          className="flex items-center gap-3 px-4 py-3 lg:hidden"
          style={{
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: `1px solid ${c.borderLight}`,
          }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              className="h-6 max-w-[100px] shrink-0 object-contain"
            />
          ) : (
            <span
              className="shrink-0 text-sm font-semibold"
              style={{ color: c.textStrong }}
            >
              {companyName}
            </span>
          )}
          <div
            className="h-4 w-px shrink-0"
            style={{ backgroundColor: c.border }}
          />
          <p
            className="min-w-0 flex-1 truncate text-sm font-medium"
            style={{ color: c.textStrong }}
          >
            {roleTitle}
          </p>
          {/* Status dot */}
          <div className="relative flex h-2 w-2 shrink-0">
            {!isClosed && convStatus === "active" && (
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{
                  backgroundColor: "#0a8a5a",
                  animation: "glowPulse 2s ease-in-out infinite",
                }}
              />
            )}
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: statusDotColor }}
            />
          </div>
          {/* Info toggle */}
          <button
            onClick={() => setMobileInfoOpen(!mobileInfoOpen)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={{
              border: `1px solid ${c.borderLight}`,
              color: c.textMuted,
              backgroundColor: mobileInfoOpen ? c.primaryTint : "transparent",
            }}
            aria-label="Toggle role details"
          >
            <svg
              width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            >
              {mobileInfoOpen ? (
                <path d="M4 6l4 4 4-4" />
              ) : (
                <>
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 7v4M8 5.5v.01" />
                </>
              )}
            </svg>
          </button>
        </header>

        {/* Mobile info panel — animated slide-down */}
        <div
          className="overflow-hidden transition-all duration-300 ease-out lg:hidden"
          style={{
            maxHeight: mobileInfoOpen ? "250px" : "0",
            opacity: mobileInfoOpen ? 1 : 0,
          }}
        >
          <div
            className="px-4 py-3"
            style={{
              background: "rgba(255,255,255,0.6)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              borderBottom: `1px solid ${c.borderLight}`,
            }}
          >
            <div className="flex flex-wrap gap-2 text-xs">
              {location && (
                <span
                  className="rounded-full px-2.5 py-1"
                  style={{ backgroundColor: c.primaryTint, color: c.textBody }}
                >
                  {location}
                </span>
              )}
              {employmentType && (
                <span
                  className="rounded-full px-2.5 py-1"
                  style={{ backgroundColor: c.primaryTint, color: c.textBody }}
                >
                  {employmentType}
                </span>
              )}
              {salaryMin && salaryMax && (
                <span
                  className="rounded-full px-2.5 py-1"
                  style={{ backgroundColor: c.primaryTint, color: c.textBody }}
                >
                  R{salaryMin.toLocaleString()} – R{salaryMax.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Desktop header — minimal with live status */}
        <header
          className="hidden items-center gap-3 px-6 py-3.5 lg:flex"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: `1px solid ${c.borderLight}`,
          }}
        >
          <div className="relative flex h-2.5 w-2.5 shrink-0">
            {!isClosed && convStatus === "active" && (
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{
                  backgroundColor: "#0a8a5a",
                  animation: "glowPulse 2s ease-in-out infinite",
                }}
              />
            )}
            <span
              className="relative inline-flex h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: statusDotColor }}
            />
          </div>
          <p
            className="text-sm font-medium"
            style={{ color: c.textStrong }}
          >
            Recruitment Assistant
          </p>
          <span className="text-xs" style={{ color: c.textFaint }}>
            {statusLabel}
          </span>
        </header>

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-y-auto scroll-smooth"
        >
          {/* Subtle grid texture */}
          <div className="paper-grid pointer-events-none absolute inset-0 opacity-30" />
          {/* Top fade */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 h-6"
            style={{ background: `linear-gradient(${c.chatBg}, transparent)` }}
          />
          {/* Bottom fade */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-6"
            style={{ background: `linear-gradient(transparent, ${c.chatBg})` }}
          />

          <div className="relative z-10 mx-auto max-w-2xl px-4 py-8 sm:px-6">
            {/* Loading spinner */}
            {initialLoading && (
              <div className="flex items-center justify-center py-24">
                <div
                  className="h-7 w-7 animate-spin rounded-full border-2"
                  style={{
                    borderColor: c.spinnerTrack,
                    borderTopColor: c.spinnerHead,
                  }}
                />
              </div>
            )}

            {/* Empty state */}
            {!initialLoading && messages.length === 0 && !isStreaming && (
              <div
                className="flex flex-col items-center justify-center py-24 text-center"
                style={{
                  animation:
                    "fadeInUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
                }}
              >
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt={companyName}
                    className="mx-auto mb-8 h-10 max-w-[180px] object-contain"
                  />
                )}
                <div className="relative mb-6">
                  <div
                    className="flex h-20 w-20 items-center justify-center rounded-3xl"
                    style={{ backgroundColor: c.primaryTint }}
                  >
                    <svg
                      width="32" height="32" viewBox="0 0 24 24" fill="none"
                      stroke={c.primary} strokeWidth="1.5" strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 20.5c4.694 0 8.5-3.134 8.5-7s-3.806-7-8.5-7-8.5 3.134-8.5 7c0 1.527.554 2.945 1.5 4.106L3.5 20.5l3.394-1.06A10.29 10.29 0 0012 20.5z" />
                    </svg>
                  </div>
                  <div
                    className="absolute -right-1 -top-1 h-4 w-4 rounded-full"
                    style={{
                      backgroundColor: c.primary,
                      animation: "pulse-subtle 2s ease-in-out infinite",
                    }}
                  />
                </div>
                <p
                  className="font-display-italic text-2xl"
                  style={{ color: c.textStrong }}
                >
                  Starting your conversation
                </p>
                <p
                  className="mt-2 max-w-xs text-sm leading-relaxed"
                  style={{ color: c.textMuted }}
                >
                  The recruitment assistant will be with you shortly.
                </p>
              </div>
            )}

            {/* Message list */}
            <div className="space-y-1.5">
              {messages.map((msg, i) => {
                const isUser = msg.role === "user";
                const displayText = getMessageText(msg);
                const isFirst =
                  i === 0 || messages[i - 1].role !== msg.role;

                if (!displayText) return null;

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"} ${isFirst ? "mt-6" : ""}`}
                    style={{
                      animation:
                        "messageIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
                    }}
                  >
                    <div className="relative max-w-[85%] sm:max-w-[75%]">
                      {/* Sender label */}
                      {isFirst && !isUser && (
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: c.primary }}
                          />
                          <span
                            className="text-[0.65rem] font-semibold uppercase tracking-[0.08em]"
                            style={{ color: c.textMuted }}
                          >
                            Assistant
                          </span>
                        </div>
                      )}
                      {isFirst && isUser && (
                        <p
                          className="mb-1.5 text-right text-[0.65rem] font-semibold uppercase tracking-[0.08em]"
                          style={{ color: c.textFaint }}
                        >
                          You
                        </p>
                      )}

                      {/* Message bubble */}
                      {isUser ? (
                        <div
                          className="rounded-2xl rounded-br-md px-4 py-2.5 text-[0.84rem] leading-relaxed"
                          style={{
                            backgroundColor: c.userBubbleBg,
                            color: c.userBubbleText,
                            boxShadow: `0 2px 12px rgba(${hexToRgb(c.primary).join(",")},0.18)`,
                          }}
                        >
                          {displayText}
                        </div>
                      ) : (
                        <div
                          className="chat-markdown rounded-r-2xl rounded-l px-4 py-2.5 text-[0.84rem] leading-relaxed"
                          style={{
                            backgroundColor: "#ffffff",
                            borderLeft: `3px solid ${c.primary}`,
                            boxShadow: "0 1px 8px rgba(0,0,0,0.04)",
                            color: c.textBody,
                          }}
                          dangerouslySetInnerHTML={{
                            __html: marked.parse(displayText, { async: false, gfm: true, breaks: true }) as string,
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {isStreaming &&
                (messages.length === 0 ||
                  messages[messages.length - 1].role === "user") && (
                  <div className="mt-6 flex justify-start">
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: c.primary }}
                        />
                        <span
                          className="text-[0.65rem] font-semibold uppercase tracking-[0.08em]"
                          style={{ color: c.textMuted }}
                        >
                          Assistant
                        </span>
                      </div>
                      <div
                        className="inline-flex items-center gap-[5px] rounded-r-2xl rounded-l px-5 py-3.5"
                        style={{
                          backgroundColor: "#ffffff",
                          borderLeft: `3px solid ${c.primary}`,
                          boxShadow: "0 1px 8px rgba(0,0,0,0.04)",
                        }}
                      >
                        {[0, 0.15, 0.3].map((delay) => (
                          <span
                            key={delay}
                            className="h-[6px] w-[6px] rounded-full"
                            style={{
                              backgroundColor: c.primarySoft,
                              animation: `typeWave 1.4s ease-in-out ${delay}s infinite`,
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

        {/* Floating composer */}
        <div className="px-4 pb-4 pt-2 sm:px-6">
          <div className="mx-auto max-w-2xl">
            <div
              className="flex items-end gap-3 rounded-2xl bg-white px-4 py-3"
              style={{
                boxShadow:
                  "0 2px 20px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
              }}
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
                className="min-h-[1.5rem] flex-1 resize-none overflow-hidden bg-transparent text-sm outline-none placeholder:text-sm disabled:opacity-40"
                style={{ color: c.textStrong }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!inputValue.trim() || isStreaming || isClosed}
                className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-25 disabled:hover:scale-100"
                style={{
                  backgroundColor: c.primary,
                  color: c.primaryText,
                }}
                aria-label="Send message"
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function SidebarRow({
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
      <span className="shrink-0 text-xs" style={{ color: c.sidebarTextFaint }}>
        {label}
      </span>
      <span
        className="text-right text-xs font-medium"
        style={{ color: c.sidebarText }}
      >
        {value}
      </span>
    </div>
  );
}
