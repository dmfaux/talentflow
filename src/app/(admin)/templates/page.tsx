"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PromptModal } from "@/components/admin/template-editor/modal";

type TemplateStatus = "draft" | "pending" | "published" | "archived";

interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  owner_client_id: string | null;
  owner_client_name: string | null;
  source: "builtin" | "custom";
  status: TemplateStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_STYLES: Record<TemplateStatus, { label: string; dot: string; text: string }> = {
  draft:     { label: "Draft",     dot: "bg-ink-muted", text: "text-txt-secondary" },
  pending:   { label: "Pending",   dot: "bg-saffron",   text: "text-saffron" },
  published: { label: "Published", dot: "bg-green",     text: "text-green" },
  archived:  { label: "Archived",  dot: "bg-red",       text: "text-red" },
};

type FilterTab = "all" | "shared" | "bespoke";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "shared", label: "Shared Library" },
  { id: "bespoke", label: "Bespoke" },
];

function formatCreated(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/templates")
      .then((r) => r.json())
      .then((res) => setTemplates(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function createCustomTemplate(name: string) {
    // Derive a key from the name: lowercase, underscores, must start
    // with a letter. Append a timestamp suffix to avoid collisions.
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const baseKey = /^[a-z]/.test(slug) ? slug : `t_${slug}`;
    const key = `${baseKey}_${Date.now().toString(36)}`;

    setCreating(true);
    setCreateError(null);
    try {
      // Starter tree matching src/lib/templates/tree-ops.ts makeStarterTree
      const starterTree = {
        version: 1,
        root: {
          id: "root",
          type: "root",
          bg: { kind: "color", color: { kind: "hex", value: "#ffffff" } },
          children: [
            {
              id: "shell",
              type: "container",
              maxWidth: 720,
              padding: { top: 3, right: 1.5, bottom: 3, left: 1.5 },
              align: "center",
              children: [
                {
                  id: "title",
                  type: "heading",
                  level: 1,
                  text: { kind: "bind", field: "campaign.role_title" },
                  typography: {
                    family: "serif",
                    weight: 500,
                    size: 2.25,
                    italic: false,
                    lineHeight: 1.15,
                    letterSpacing: -0.01,
                    uppercase: false,
                    color: { kind: "brand", token: "primary" },
                  },
                  align: "left",
                  maxWidth: null,
                },
                {
                  id: "form",
                  type: "form_slot",
                  heading: "Apply for this role",
                  subheading: null,
                  cardStyle: "bordered",
                },
              ],
            },
          ],
        },
      };
      const res = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          name,
          source: "custom",
          block_tree: starterTree,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError(body.error ?? "Failed to create template");
        return;
      }
      setPromptOpen(false);
      router.push(`/templates/${body.data.id}/edit`);
    } catch {
      setCreateError("Something went wrong. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleClone(templateId: string) {
    setCreateError(null);
    const res = await fetch(`/api/admin/templates/${templateId}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    if (!res.ok) {
      setCreateError(body.error ?? "Clone failed");
      return;
    }
    router.push(`/templates/${body.data.id}/edit`);
  }

  const filtered = useMemo(() => {
    if (activeTab === "all") return templates;
    if (activeTab === "shared")
      return templates.filter((t) => t.owner_client_id === null);
    return templates.filter((t) => t.owner_client_id !== null);
  }, [templates, activeTab]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Templates</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            Template library available to campaigns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/templates/new"
            className="inline-flex h-9 items-center rounded-lg px-3 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
          >
            Register builtin
          </Link>
          <button
            type="button"
            disabled={creating}
            onClick={() => {
              setCreateError(null);
              setPromptOpen(true);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cobalt px-4 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            New template
          </button>
        </div>
      </div>
      {createError && (
        <div className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-xs text-red">
          {createError}
        </div>
      )}

      {/* Filter tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-canvas-2 p-1">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                active
                  ? "bg-paper text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Name
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Key
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Owner
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Status
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-txt-muted"
                >
                  Loading templates...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-txt-muted"
                >
                  No templates registered yet.{" "}
                  <Link
                    href="/templates/new"
                    className="text-cobalt hover:underline"
                  >
                    Register one
                  </Link>
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const editable = t.source === "custom";
                return (
                <tr
                  key={t.id}
                  onClick={() => {
                    if (editable) router.push(`/templates/${t.id}/edit`);
                  }}
                  className={`group transition-colors hover:bg-cream/60 ${editable ? "cursor-pointer" : ""}`}
                >
                  <td className="px-5 py-3">
                    <div className="font-display text-sm font-medium text-charcoal">
                      {t.name}
                    </div>
                    {t.description && (
                      <div className="mt-0.5 text-xs text-ink-muted">
                        {t.description}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-muted">
                    {t.key}
                  </td>
                  <td className="px-5 py-3 text-sm">
                    {t.owner_client_id === null ? (
                      <span className="text-ink-muted">Shared Library</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-medium text-charcoal">
                          {t.owner_client_name ?? "Unknown"}
                        </span>
                        <span className="inline-flex items-center rounded-sm bg-vermillion/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-vermillion">
                          Bespoke
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_STYLES[t.status].dot}`}
                      />
                      <span className={STATUS_STYLES[t.status].text}>
                        {STATUS_STYLES[t.status].label}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-txt-secondary">
                    <div className="flex items-center justify-between gap-2">
                      <span>{formatCreated(t.created_at)}</span>
                      {editable && (
                        <button
                          type="button"
                          title="Clone to new draft"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleClone(t.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex h-6 items-center rounded px-2 text-[0.65rem] font-medium text-txt-secondary hover:bg-cream hover:text-charcoal cursor-pointer"
                        >
                          Clone
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PromptModal
        open={promptOpen}
        onClose={() => {
          if (!creating) setPromptOpen(false);
        }}
        onSubmit={(name) => void createCustomTemplate(name)}
        title="New custom template"
        label="Template name"
        placeholder="Untitled template"
        defaultValue="Untitled template"
        confirmLabel="Create"
        busy={creating}
      />
    </div>
  );
}
