"use client";

import { createRoot, type Root } from "react-dom/client";
import { useEffect, useRef, useMemo } from "react";
import {
  ApplicationForm,
  type BrandColours,
  type ApplicationFormCampaign,
} from "./ApplicationForm";

interface Props {
  html: string;
  clientSlug: string;
  clientName: string;
  campaign: ApplicationFormCampaign;
  brandColours: BrandColours;
}

/**
 * Extract <style> blocks and body content from a full HTML document so the
 * template can be embedded inside the Next.js page without nested document
 * tags.
 */
function extractBodyContent(html: string): string {
  const styles: string[] = [];
  const styleRe = /<style[^>]*>[\s\S]*?<\/style\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html)) !== null) styles.push(m[0]);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
  if (bodyMatch) return styles.join("\n") + "\n" + bodyMatch[1];

  // Fallback for HTML that's already just body content
  return html
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head\s*>/i, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .trim();
}

export function HtmlTemplateRenderer({
  html,
  clientSlug,
  clientName,
  campaign,
  brandColours,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formRootRef = useRef<Root | null>(null);

  const safeHtml = useMemo(() => extractBodyContent(html), [html]);

  // Store latest props in refs so the effect doesn't re-run on every render
  const propsRef = useRef({ clientSlug, clientName, campaign, brandColours });
  propsRef.current = { clientSlug, clientName, campaign, brandColours };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set innerHTML ourselves — React never touches this div's children.
    container.innerHTML = safeHtml;

    const mount = container.querySelector<HTMLElement>("#application-form");
    if (!mount) return;

    // Create an independent React root inside the mount point.
    const root = createRoot(mount);
    formRootRef.current = root;

    const p = propsRef.current;
    root.render(
      <ApplicationForm
        clientSlug={p.clientSlug}
        clientName={p.clientName}
        campaign={p.campaign}
        brandColours={p.brandColours}
      />
    );

    return () => {
      root.unmount();
      formRootRef.current = null;
    };
  }, [safeHtml]);

  // No dangerouslySetInnerHTML — we fully manage innerHTML in the effect.
  return <div ref={containerRef} suppressHydrationWarning />;
}
