"use client";

export interface Tracker {
  track(type: string, metadata?: Record<string, unknown>): void;
  flush(): void;
}

interface QueuedEvent {
  type: string;
  metadata?: Record<string, unknown>;
}

const FLUSH_DEBOUNCE_MS = 2000;
const MAX_BATCH_SIZE = 10;

/**
 * Get or create a persistent visitor ID (survives browser restarts).
 * Scoped per campaign so clearing one doesn't affect another.
 */
function getVisitorId(clientSlug: string, campaignSlug: string): string {
  const key = `ts_vid_${clientSlug}_${campaignSlug}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Get or create a session ID (survives page refreshes within the same tab,
 * resets when the tab is closed).
 */
function getSessionId(clientSlug: string, campaignSlug: string): string {
  const key = `ts_sid_${clientSlug}_${campaignSlug}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function createTracker(clientSlug: string, campaignSlug: string): Tracker {
  const sessionId = getSessionId(clientSlug, campaignSlug);
  const visitorId = getVisitorId(clientSlug, campaignSlug);
  const queue: QueuedEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function buildPayload() {
    return JSON.stringify({
      client_slug: clientSlug,
      campaign_slug: campaignSlug,
      session_id: sessionId,
      visitor_id: visitorId,
      events: queue.splice(0),
    });
  }

  function flush() {
    if (queue.length === 0) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const payload = buildPayload();

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/events",
        new Blob([payload], { type: "application/json" }),
      );
    } else {
      fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }

  function scheduleFlush() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }

  // Flush on page hide / unload
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flush);
  }

  function track(type: string, metadata?: Record<string, unknown>) {
    queue.push({ type, metadata });
    if (queue.length >= MAX_BATCH_SIZE) {
      flush();
    } else {
      scheduleFlush();
    }
  }

  return { track, flush };
}
