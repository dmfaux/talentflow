"use client";

import { PreviewStatusOverlay } from "./theme-email-preview";
import type { PreviewStatus } from "./use-theme-preview";

// Live landing-page preview — the landing analogue of EmailPreviewFrame. The
// builder owns the fetch (POST /api/operator/themes/landing-preview, via
// useThemePreview) so the same rendered HTML feeds the inline frame, the
// open-in-new-tab action, and the realistic dialog; this frame just drops the
// HTML into a sandboxed <iframe srcDoc>.
//
// The endpoint renders a VALID bespoke landing when one is supplied (real
// precedence), else the palette-generated landing from the draft — so the preview
// always shows what a candidate would actually get.

export function LandingPreviewFrame({
  html,
  status,
  height = 560,
}: {
  html: string | null;
  status: PreviewStatus;
  height?: number;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-lg bg-white"
      style={{ height, width: "100%" }}
    >
      {html !== null && (
        <iframe
          srcDoc={html}
          sandbox="allow-same-origin"
          title="Landing preview"
          style={{ width: "100%", height, border: 0 }}
        />
      )}
      <PreviewStatusOverlay
        status={status}
        errorText="Preview unavailable — check the palette and pasted HTML."
      />
    </div>
  );
}
