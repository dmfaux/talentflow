import { error, requireApiOperator, success } from "@/lib/api";
import { chatInvitationEmail, resolveEmailSubject } from "@/lib/email";
import { type EmailTheme } from "@/lib/theme";
import {
  normaliseThemeFields,
  type ThemeWriteValues,
} from "@/lib/theme-fields";
import { fontImportsFor } from "@/lib/theme-fonts";
import { isLogoBackground, isLogoPosition } from "@/lib/utils";
import { NextRequest } from "next/server";

// Map validated ThemeWriteValues into the EmailTheme the renderers read. Reuses
// normaliseThemeFields' palette/font derivation so the live preview matches
// exactly what a saved theme resolves to (no parallel derivation to drift). The
// bespoke email_shell rides through, so a custom draft previews its real chrome;
// a gallery draft (no shell) previews the in-code default chrome, recoloured.
function emailThemeFromValues(
  values: ThemeWriteValues,
  body: Record<string, unknown>
): EmailTheme {
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
  return {
    palette: values.palette as EmailTheme["palette"],
    fontDisplay: values.font_display,
    fontSans: values.font_sans,
    logo: logoUrl
      ? { url: logoUrl, background: logoBackground, position: logoPosition }
      : null,
    showPoweredBy: values.show_powered_by,
    emailShell: values.email_shell,
    fontImports: fontImportsFor(values.font_display_key, values.font_body_key),
  };
}

// POST /api/operator/themes/preview — render a live email preview for the
// theme-builder form (operator-gated).
//
// MUST be a server endpoint: src/lib/email.ts imports @/db at module scope, so
// its template functions can't be pulled into a client component. The builder
// posts its unsaved form values here (debounced) and drops the returned HTML into
// an <iframe srcDoc>. We render the exact send-path template so the preview is
// faithful: a custom draft's email_shell wraps a real (deterministic) body; a
// recolour-only draft renders the default chrome. chatInvitation is the sample —
// it exercises the most chrome (brand header, info card, action button, footer)
// inside the shell.
const SAMPLE = {
  candidate: "Sam",
  role: "Senior Software Engineer",
  company: "Northwind Studio",
  url: "https://example.com/continue",
} as const;

export async function POST(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;
  void ctx;

  try {
    const body = await request.json();

    // Validate + derive the whole draft through the SAME contract the write path
    // uses (seeds→palette, font keys→stacks/imports, email_shell validation), so
    // the preview is byte-faithful to a saved theme. The preview payload carries
    // only render fields (no scope/name/org); inject preview-only placeholders.
    // Scope "custom" keeps the draft's email_shell alive (gallery would force it
    // null) and satisfies the custom-scope invariant. None of these are persisted.
    const result = normaliseThemeFields({
      ...body,
      scope: "custom",
      name: "Preview",
      org_id: "preview",
      client_id: "preview",
    });
    if (!result.ok) return error(result.message, result.status);

    // Draw the brand's real name into the sample so the preview reads like this
    // brand's send; fall back to the default stand-in when none is supplied
    // (e.g. gallery themes, which aren't brand-scoped).
    const company =
      typeof body.brand_name === "string" && body.brand_name.trim()
        ? body.brand_name.trim()
        : SAMPLE.company;

    const theme = emailThemeFromValues(result.values, body);
    const data = {
      candidate: { name: SAMPLE.candidate },
      campaign: { role_title: SAMPLE.role },
      client: { name: company },
    };
    const html = chatInvitationEmail(
      theme,
      SAMPLE.candidate,
      SAMPLE.role,
      company,
      SAMPLE.url
    );
    // The real subject (same resolver the send path uses) labels the inbox mock.
    const subject = resolveEmailSubject("chatInvitation", data);

    return success({
      html,
      subject,
      sample: { company, candidate: SAMPLE.candidate, role: SAMPLE.role },
    });
  } catch (err) {
    console.error("POST /api/operator/themes/preview error:", err);
    return error("Internal server error", 500);
  }
}
