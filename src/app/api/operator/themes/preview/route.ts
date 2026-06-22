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
import { type EmailTheme } from "@/lib/theme";
import {
  normaliseThemeFields,
  type ThemeWriteValues,
} from "@/lib/theme-fields";
import { fontImportsFor } from "@/lib/theme-fonts";
import { isLogoBackground, isLogoPosition } from "@/lib/utils";
import { NextRequest } from "next/server";

// Map validated ThemeWriteValues into the EmailTheme the renderers read. Reuses
// normaliseThemeFields' palette/font/copy derivation so the live preview matches
// exactly what a saved theme would resolve to (no parallel derivation to drift).
// Logo is assembled from the body (the preview payload carries the brand's logo
// fields verbatim); copy/fontImports/emailTemplates ride from the validated values.
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
    emailTemplates: values.email_templates,
    fontImports: fontImportsFor(values.font_display_key, values.font_body_key),
    landingCopy: values.landing_copy,
    emailCopy: values.email_copy,
  };
}

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

    // CT7: validate + derive the whole draft through the SAME contract the write
    // path uses (seeds→palette, font keys→stacks/imports, copy normalisation,
    // bespoke email_templates), so the preview is byte-faithful to a saved theme.
    // The preview payload carries only render fields (no scope/name/org), so we
    // inject preview-only placeholders: scope "custom" keeps the draft's bespoke
    // email_templates alive (gallery would force them null), and the placeholder
    // org/client satisfy the custom-scope invariant. None of these are persisted.
    const result = normaliseThemeFields({
      ...body,
      scope: "custom",
      name: "Preview",
      org_id: "preview",
      client_id: "preview",
    });
    if (!result.ok) return error(result.message, result.status);

    const theme = emailThemeFromValues(result.values, body);

    const html = renderSampleEmail(type, theme);

    return success({ html });
  } catch (err) {
    console.error("POST /api/operator/themes/preview error:", err);
    return error("Internal server error", 500);
  }
}
