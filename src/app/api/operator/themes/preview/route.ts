import { error, requireApiOperator, success } from "@/lib/api";
import {
  applicationReceivedEmail,
  chatAccessEmail,
  chatInvitationEmail,
  chatNudgeEmail,
  gatingFailedEmail,
  gatingPassedEmail,
  noResponseEmail,
  rejectionConfirmationEmail,
  rejectionEmail,
} from "@/lib/email";
import {
  type EmailTemplateType,
  isEmailTemplateType,
} from "@/lib/email-slots";
import { DEFAULT_EMAIL_THEME, type EmailTheme } from "@/lib/theme";
import { normaliseEmailTemplates, normaliseThemePalette } from "@/lib/theme-fields";
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
//
// CT6: the body may carry an optional `template_type` (one of the nine bespoke
// email types; default "applicationReceived") AND the draft `email_templates`
// map, so a bespoke per-template override previews live BEFORE it is saved — the
// EmailTheme we build rides those templates through renderThemedEmail exactly as
// the send path does. With no override for the chosen type (or no map at all) the
// generated kit is rendered, so the recolour-only preview keeps working.

// Realistic sample data substituted into both the generated kit and any bespoke
// override (via the email slots). The action URL backs every link-bearing
// template; closeBy + adminReason cover the chatNudge / rejectionConfirmation
// slots. adminReason is intentionally blank so its conditional block disappears.
const SAMPLE = {
  candidate: "Sam",
  role: "Senior Software Engineer",
  company: "Northwind Studio",
  url: "https://example.com/continue",
  closeBy: "12 July 2026",
  adminReason: "",
} as const;

// Map each bespoke email type to its themed send-path template, called with the
// sample data in the same argument order the send path uses (note chatAccess has
// no company name, and chatNudge / rejectionConfirmation take extra arguments).
function renderSampleEmail(type: EmailTemplateType, theme: EmailTheme): string {
  switch (type) {
    case "applicationReceived":
      return applicationReceivedEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company);
    case "gatingPassed":
      return gatingPassedEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company);
    case "gatingFailed":
      return gatingFailedEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company);
    case "rejection":
      return rejectionEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company);
    case "chatInvitation":
      return chatInvitationEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company, SAMPLE.url);
    case "chatAccess":
      return chatAccessEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.url);
    case "chatNudge":
      return chatNudgeEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company, SAMPLE.url, SAMPLE.closeBy);
    case "noResponse":
      return noResponseEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company);
    case "rejectionConfirmation":
      return rejectionConfirmationEmail(theme, SAMPLE.candidate, SAMPLE.role, SAMPLE.company, SAMPLE.adminReason);
  }
}

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

    // The template to preview. Default to the application-received email so the
    // recolour-only preview keeps its existing behaviour when no type is sent;
    // any supplied value must be one of the nine known bespoke email types.
    let type: EmailTemplateType = "applicationReceived";
    if (body.template_type != null) {
      if (!isEmailTemplateType(body.template_type)) {
        return error("template_type is not a known email template");
      }
      type = body.template_type;
    }

    // Draft bespoke templates ride on the theme so an override previews before it
    // is saved. Validated against the per-type email contract (same as the write
    // path) so a malformed draft returns a precise 400 rather than rendering junk.
    const emailResult = normaliseEmailTemplates(body.email_templates);
    if (!emailResult.ok) return error(emailResult.message);

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
      // CT6: the draft bespoke per-template HTML (null when none authored).
      emailTemplates: emailResult.templates,
    };

    const html = renderSampleEmail(type, theme);

    return success({ html });
  } catch (err) {
    console.error("POST /api/operator/themes/preview error:", err);
    return error("Internal server error", 500);
  }
}
