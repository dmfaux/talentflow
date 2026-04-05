"use client";

// Editor iframe preview. Lives at /preview/template/editor. The parent
// editor page posts {type:"tree"} messages with the current draft
// block tree + demo client/campaign; this page re-renders on each
// message. No DB access — state is entirely driven by postMessage.

import { useEffect, useState } from "react";
import { BlockTreeRenderer } from "@/templates/blocks/renderer";
import { parseBlockTree, type BlockTree } from "@/templates/blocks/schema";
import type { TemplateCampaign, TemplateClient } from "@/templates/types";

// Shipped with the iframe so the preview has *something* on load.
const PLACEHOLDER_CLIENT: TemplateClient = {
  slug: "acme-co",
  name: "Acme Co.",
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "#0b3a82",
  brand_secondary_color: "#f5f7fb",
  brand_accent_color: "#f0a500",
  brand_text_color: "#0b0f1c",
};

const PLACEHOLDER_CAMPAIGN: TemplateCampaign = {
  slug: "sample-role",
  role_title: "Senior Role",
  role_description:
    "Short description of the role the candidate will be applying to. Replace this with the actual description when a campaign is created.",
  department: "Engineering",
  location: "Cape Town",
  employment_type: "Full-time",
  salary_range_min: 800_000,
  salary_range_max: 1_100_000,
  gating_config: [],
};

interface PreviewState {
  tree: BlockTree | null;
  client: TemplateClient;
  campaign: TemplateCampaign;
  validationError: string | null;
}

interface ParentMessage {
  type: "tree";
  tree: unknown;
  client?: TemplateClient;
  campaign?: TemplateCampaign;
}

export default function EditorPreview() {
  const [state, setState] = useState<PreviewState>({
    tree: null,
    client: PLACEHOLDER_CLIENT,
    campaign: PLACEHOLDER_CAMPAIGN,
    validationError: null,
  });

  useEffect(() => {
    // Accept messages only from the parent window at the same origin —
    // prevents a hostile outer frame from injecting arbitrary content.
    const handler = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if (e.origin !== window.location.origin) return;
      const msg = e.data as ParentMessage | { type: string };
      if (!msg || msg.type !== "tree") return;
      const payload = msg as ParentMessage;
      const parsed = parseBlockTree(payload.tree);
      if (!parsed.ok) {
        setState((s) => ({
          ...s,
          validationError: parsed.errors.join("; "),
        }));
        return;
      }
      setState({
        tree: parsed.tree,
        client: payload.client ?? PLACEHOLDER_CLIENT,
        campaign: payload.campaign ?? PLACEHOLDER_CAMPAIGN,
        validationError: null,
      });
    };
    window.addEventListener("message", handler);

    // Tell the parent we're ready to receive the first tree.
    window.parent.postMessage({ type: "ready" }, window.location.origin);

    return () => window.removeEventListener("message", handler);
  }, []);

  if (state.validationError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          color: "#b91c1c",
          backgroundColor: "#fef2f2",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "520px" }}>
          <p style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Preview validation error
          </p>
          <p style={{ fontSize: "0.75rem", lineHeight: 1.5, fontFamily: "ui-monospace, monospace" }}>
            {state.validationError}
          </p>
        </div>
      </div>
    );
  }

  if (!state.tree) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          color: "#6b7280",
          fontSize: "0.875rem",
        }}
      >
        Waiting for preview…
      </div>
    );
  }

  return (
    <BlockTreeRenderer
      tree={state.tree}
      client={state.client}
      campaign={state.campaign}
      previewMode={true}
    />
  );
}
