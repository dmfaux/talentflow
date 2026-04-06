"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
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

export function HtmlTemplateRenderer({
  html,
  clientSlug,
  clientName,
  campaign,
  brandColours,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [formMount, setFormMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      const el = containerRef.current.querySelector<HTMLElement>(
        "#application-form"
      );
      setFormMount(el);
    }
  }, [html]);

  return (
    <>
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />
      {formMount &&
        createPortal(
          <ApplicationForm
            clientSlug={clientSlug}
            clientName={clientName}
            campaign={campaign}
            brandColours={brandColours}
          />,
          formMount
        )}
    </>
  );
}
