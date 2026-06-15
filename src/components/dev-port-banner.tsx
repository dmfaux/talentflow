"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The port this project is built to run on during local development. Several
 * local integrations hard-code it (e.g. the `jobs:poll` script hits
 * `http://localhost:3000/api/jobs/process`), so running on any other port makes
 * the app misbehave in subtle ways.
 */
const EXPECTED_DEV_PORT = "3000";

// The port can't change for the life of the page, so there's nothing to watch —
// `useSyncExternalStore` just needs a no-op subscribe.
const subscribe = () => () => {};

// Ground truth for "what port is actually serving this page". Preferred over
// `process.env.PORT`, which is unset for both the default port and the
// `next dev -p <port>` flag and so can't report the real port.
const getActualPort = () =>
  window.location.port ||
  (window.location.protocol === "https:" ? "443" : "80");

// During SSR (and the matching hydration render) the browser's port is unknown,
// so assume the expected one. The banner is therefore absent from the server
// HTML and only appears after hydration if the real port differs — no hydration
// mismatch.
const getServerPort = () => EXPECTED_DEV_PORT;

/**
 * Dev-only strap warning that the app is being served on a port other than
 * {@link EXPECTED_DEV_PORT}. Only rendered in non-production environments (gated
 * in the root layout), so it never ships to production builds.
 *
 * The strap is `position: fixed` and publishes its height to the
 * `--dev-banner-h` CSS variable so fixed/sticky page headers (which would
 * otherwise sit at viewport top:0 and be hidden behind the strap) can offset
 * themselves by `top: var(--dev-banner-h, 0px)`. The variable is unset whenever
 * the strap isn't shown, so those offsets fall back to 0.
 */
export function DevPortBanner() {
  const port = useSyncExternalStore(subscribe, getActualPort, getServerPort);
  const ref = useRef<HTMLDivElement>(null);
  const onWrongPort = port !== EXPECTED_DEV_PORT;

  useEffect(() => {
    const el = ref.current;
    if (!onWrongPort || !el) return;

    const root = document.documentElement;
    const publishHeight = () =>
      root.style.setProperty("--dev-banner-h", `${el.offsetHeight}px`);

    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);

    return () => {
      observer.disconnect();
      root.style.removeProperty("--dev-banner-h");
    };
  }, [onWrongPort]);

  if (!onWrongPort) return null;

  return (
    <div
      ref={ref}
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 border-b border-saffron-deep bg-warning px-4 py-2 text-center text-sm font-medium leading-snug text-ink"
    >
      <span aria-hidden="true">⚠️</span>
      <span>
        You&rsquo;re running on port{" "}
        <span className="font-mono font-semibold">{port}</span>, but this app
        expects port{" "}
        <span className="font-mono font-semibold">{EXPECTED_DEV_PORT}</span>{" "}
        in development — some features won&rsquo;t work as expected here.
      </span>
    </div>
  );
}
