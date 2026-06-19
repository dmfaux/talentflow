import { error, requireApiOperator, success } from "@/lib/api";
import { applicationReceivedEmail } from "@/lib/email";
import { DEFAULT_EMAIL_THEME, type EmailTheme } from "@/lib/theme";
import { normaliseThemePalette } from "@/lib/theme-fields";
import { isLogoBackground, isLogoPosition } from "@/lib/utils";
import { NextRequest } from "next/server";

// POST /api/operator/themes/preview — render a live email preview for the
// theme-builder form (operator-gated).
//
// This MUST be a server endpoint: src/lib/email.ts imports @/db at module scope,
// so its template functions can't be pulled into a client component. The builder
// posts its unsaved form values here (debounced) and drops the returned HTML into
// an <iframe srcDoc>. We render the exact send-path template so the preview is
// faithful to what candidates receive.
const SAMPLE = {
  candidate: "Alex Morgan",
  role: "Senior Product Designer",
  brand: "Northwind Studio",
} as const;

export async function POST(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;
  void ctx;

  try {
    const body = await request.json();

    const paletteResult = normaliseThemePalette(body.palette);
    if (!paletteResult.ok) {
      return error(
        paletteResult.key
          ? `palette.${paletteResult.key} must be a valid hex colour`
          : "palette must include all 11 colour tokens"
      );
    }

    const logoUrl =
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? body.logo_url.trim()
        : null;
    const logoBackground = isLogoBackground(body.logo_background)
      ? body.logo_background
      : "light";
    const logoPosition = isLogoPosition(body.logo_position)
      ? body.logo_position
      : "top-left";

    const theme: EmailTheme = {
      palette: paletteResult.palette,
      fontDisplay:
        (typeof body.font_display === "string" && body.font_display.trim()) ||
        DEFAULT_EMAIL_THEME.fontDisplay,
      fontSans:
        (typeof body.font_sans === "string" && body.font_sans.trim()) ||
        DEFAULT_EMAIL_THEME.fontSans,
      logo: logoUrl
        ? { url: logoUrl, background: logoBackground, position: logoPosition }
        : null,
      // The form forces this true for gallery; reflect whatever it sends.
      showPoweredBy: body.show_powered_by !== false,
    };

    const html = applicationReceivedEmail(
      theme,
      SAMPLE.candidate,
      SAMPLE.role,
      SAMPLE.brand
    );

    return success({ html });
  } catch (err) {
    console.error("POST /api/operator/themes/preview error:", err);
    return error("Internal server error", 500);
  }
}
