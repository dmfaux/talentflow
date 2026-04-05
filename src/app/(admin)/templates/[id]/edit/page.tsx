"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Block, BlockTree } from "@/templates/blocks/schema";
import { BlockPanel } from "@/components/admin/template-editor/block-panels";
import { ConfirmModal } from "@/components/admin/template-editor/modal";
import {
  addBlock,
  findBlock,
  generateBlockId,
  makeDefaultBlock,
  moveBlock,
  removeBlock,
  updateBlock,
} from "@/lib/templates/tree-ops";

type TemplateStatus = "draft" | "pending" | "published" | "archived";

interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  source: "builtin" | "custom";
  status: TemplateStatus;
  block_tree: unknown;
  preview_token: string | null;
  preview_token_expires_at: string | null;
  thumbnail_url: string | null;
  active_campaign_count: number;
  total_campaign_count: number;
}

interface HistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by_first_name: string | null;
  changed_by_last_name: string | null;
  changed_by_email: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

// Block types that can be added inside a container. Root and
// container can be added manually but in MVP we keep the root fixed
// and only allow adding leaf/content blocks inside existing containers.
const ADDABLE_BLOCK_TYPES: Array<{ value: Block["type"]; label: string }> = [
  { value: "logo_header", label: "Logo header" },
  { value: "eyebrow", label: "Eyebrow" },
  { value: "heading", label: "Heading" },
  { value: "meta_strip", label: "Meta strip" },
  { value: "salary_badge", label: "Salary badge" },
  { value: "rich_text", label: "Rich text" },
  { value: "form_slot", label: "Application form" },
  { value: "divider", label: "Divider" },
  { value: "spacer", label: "Spacer" },
  { value: "footer", label: "Footer" },
];

const STATUS_COLOR: Record<TemplateStatus, string> = {
  draft: "bg-ink-muted",
  pending: "bg-saffron",
  published: "bg-green",
  archived: "bg-red",
};

export default function TemplateEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [template, setTemplate] = useState<Template | null>(null);
  const [tree, setTree] = useState<BlockTree | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] =
    useState<TemplateStatus | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load template ─────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/admin/templates/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) {
          setLoadError(res.error);
          return;
        }
        const t: Template = res.data;
        setTemplate(t);
        if (t.source !== "custom") {
          setLoadError(
            "Builtin templates cannot be edited — their layout lives in code."
          );
          return;
        }
        if (!t.block_tree) {
          setLoadError(
            "This template has no block_tree. Recreate it from the templates list."
          );
          return;
        }
        setTree(t.block_tree as BlockTree);
      })
      .catch(() => setLoadError("Failed to load template"));
  }, [id]);

  // ── iframe handshake + tree posting ───────────────────────────────

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type: string };
      if (msg?.type === "ready") {
        iframeReady.current = true;
        postTree();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postTree = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframeReady.current || !tree) return;
    iframe.contentWindow?.postMessage(
      { type: "tree", tree },
      window.location.origin
    );
  }, [tree]);

  useEffect(() => {
    postTree();
  }, [tree, postTree]);

  // ── Debounced save ────────────────────────────────────────────────

  useEffect(() => {
    if (!tree || !template) return;
    if (template.status !== "draft") return; // API rejects block_tree edits on non-draft
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveState("saving");
      fetch(`/api/admin/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block_tree: tree }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res.error) setSaveState("error");
          else setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [tree, id, template]);

  // ── Tree operations bound to UI ───────────────────────────────────

  const handleBlockChange = useCallback(
    (next: Block) => {
      setTree((prev) =>
        prev ? updateBlock(prev, next.id, () => next) : prev
      );
    },
    []
  );

  const handleAddBlock = useCallback(
    (parentId: string, type: Block["type"]) => {
      setTree((prev) => {
        if (!prev) return prev;
        const newId = generateBlockId(type, prev);
        return addBlock(prev, parentId, makeDefaultBlock(type, newId));
      });
    },
    []
  );

  const handleRemoveBlock = useCallback((id: string) => {
    setTree((prev) => (prev ? removeBlock(prev, id) : prev));
    setSelectedId((curr) => (curr === id ? null : curr));
  }, []);

  const handleMoveBlock = useCallback((id: string, delta: -1 | 1) => {
    setTree((prev) => (prev ? moveBlock(prev, id, delta) : prev));
  }, []);

  // ── Status transitions ────────────────────────────────────────────

  const executeTransition = useCallback(
    async (to: TemplateStatus) => {
      setTransitionError(null);
      setTransitionBusy(true);
      try {
        const res = await fetch(
          `/api/admin/templates/${id}/transition`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to }),
          }
        );
        const body = await res.json();
        if (!res.ok) {
          setTransitionError(body.error ?? "Transition failed");
          return;
        }
        // Merge returned row — preserves active_campaign_count which
        // the transition response doesn't include.
        setTemplate((prev) =>
          prev ? { ...prev, ...body.data } : body.data
        );
        setPendingTransition(null);
        // Invalidate history cache so the next open refetches.
        setHistory(null);
      } finally {
        setTransitionBusy(false);
      }
    },
    [id]
  );

  const handleClone = useCallback(async () => {
    setCloning(true);
    try {
      const res = await fetch(`/api/admin/templates/${id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) {
        setTransitionError(body.error ?? "Clone failed");
        return;
      }
      router.push(`/templates/${body.data.id}/edit`);
    } finally {
      setCloning(false);
    }
  }, [id, router]);

  const handleCopyLink = useCallback(async () => {
    if (!template?.preview_token) return;
    const url = `${window.location.origin}/preview/template/pending/${template.preview_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard API can fail in insecure contexts; fall through.
    }
  }, [template?.preview_token]);

  const handleOpenHistory = useCallback(async () => {
    setHistoryOpen(true);
    if (history !== null) return;
    const res = await fetch(`/api/admin/templates/${id}/history`);
    const body = await res.json();
    if (res.ok) setHistory(body.data);
  }, [id, history]);

  // ── Flattened tree for rendering ──────────────────────────────────

  interface FlatRow {
    block: Block;
    depth: number;
    parentId: string | null;
    canMoveUp: boolean;
    canMoveDown: boolean;
  }

  const flatRows = useMemo<FlatRow[]>(() => {
    if (!tree) return [];
    const rows: FlatRow[] = [];
    const goByRoot = (b: Block, depth: number, parentId: string | null) => {
      let siblingIndex = 0;
      let siblingCount = 1;
      if (parentId) {
        const p = findBlock(tree, parentId);
        if (p && (p.type === "root" || p.type === "container")) {
          siblingIndex = p.children.findIndex((c) => c.id === b.id);
          siblingCount = p.children.length;
        }
      }
      rows.push({
        block: b,
        depth,
        parentId,
        canMoveUp: siblingIndex > 0,
        canMoveDown: siblingIndex < siblingCount - 1,
      });
      if (b.type === "root" || b.type === "container") {
        for (const c of b.children) goByRoot(c, depth + 1, b.id);
      }
    };
    goByRoot(tree.root, 0, null);
    return rows;
  }, [tree]);

  const selectedBlock = useMemo(() => {
    if (!tree || !selectedId) return null;
    return findBlock(tree, selectedId);
  }, [tree, selectedId]);

  // ── UI states ─────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-sm text-red mb-4">{loadError}</p>
        <Link href="/templates" className="text-xs text-cobalt hover:underline">
          ← Back to templates
        </Link>
      </div>
    );
  }

  if (!template || !tree) {
    return (
      <div className="py-16 text-center text-sm text-txt-muted">Loading…</div>
    );
  }

  const isDraft = template.status === "draft";

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-theme(spacing.16))] flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-5">
        <div className="flex items-center gap-3">
          <Link
            href="/templates"
            className="text-[0.8rem] text-txt-muted hover:text-charcoal transition-colors"
          >
            ← Templates
          </Link>
          <span className="text-txt-muted">/</span>
          <span className="text-[0.85rem] font-medium text-charcoal">
            {template.name}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[0.7rem]">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_COLOR[template.status]}`} />
            <span className="text-txt-secondary capitalize">{template.status}</span>
          </span>
          {isDraft && (
            <span className="text-[0.7rem] text-txt-muted ml-2">
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Saved"}
              {saveState === "error" && (
                <span className="text-red">Save failed</span>
              )}
            </span>
          )}
        </div>
        <div className="relative flex items-center gap-2">
          {transitionError && (
            <span className="text-[0.7rem] text-red mr-2">
              {transitionError}
            </span>
          )}
          <button
            type="button"
            onClick={handleOpenHistory}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-[0.72rem] text-txt-secondary hover:bg-cream hover:text-charcoal cursor-pointer"
          >
            History
          </button>
          <button
            type="button"
            onClick={() => void handleClone()}
            disabled={cloning}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-[0.72rem] text-txt-secondary hover:bg-cream hover:text-charcoal disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {cloning ? "Cloning…" : "Clone"}
          </button>
          <TransitionButtons
            status={template.status}
            onRequest={setPendingTransition}
            previewToken={template.preview_token}
            linkCopied={linkCopied}
            onCopyLink={handleCopyLink}
          />
          {historyOpen && (
            <HistoryPanel
              entries={history}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>
      </header>

      <ConfirmModal
        open={pendingTransition !== null}
        onClose={() => setPendingTransition(null)}
        onConfirm={() =>
          pendingTransition && void executeTransition(pendingTransition)
        }
        busy={transitionBusy}
        title={modalTitle(pendingTransition)}
        body={modalBody(pendingTransition, template)}
        confirmLabel={modalConfirmLabel(pendingTransition)}
        variant={pendingTransition === "archived" ? "danger" : "primary"}
      />

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel: tree + properties */}
        <aside className="flex w-[380px] flex-col border-r border-border">
          <div className="overflow-auto border-b border-border bg-surface">
            <TreeView
              rows={flatRows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAdd={handleAddBlock}
              onRemove={handleRemoveBlock}
              onMove={handleMoveBlock}
              canEdit={isDraft}
            />
          </div>
          <div className="flex-1 overflow-auto bg-cream/20 p-4">
            {selectedBlock ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
                    {selectedBlock.type} · {selectedBlock.id}
                  </span>
                </div>
                <fieldset disabled={!isDraft} className="disabled:opacity-60">
                  <BlockPanel block={selectedBlock} onChange={handleBlockChange} />
                </fieldset>
              </>
            ) : (
              <p className="text-[0.78rem] text-txt-muted">
                Select a block to edit its properties.
              </p>
            )}
          </div>
        </aside>

        {/* Right panel: iframe */}
        <main className="flex-1 overflow-hidden bg-canvas-2">
          <iframe
            ref={iframeRef}
            src="/preview/template/editor"
            title="Template preview"
            className="h-full w-full border-0 bg-paper"
          />
        </main>
      </div>
    </div>
  );
}

// ── Tree view ───────────────────────────────────────────────────────

function TreeView({
  rows,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  canEdit,
}: {
  rows: Array<{
    block: Block;
    depth: number;
    parentId: string | null;
    canMoveUp: boolean;
    canMoveDown: boolean;
  }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (parentId: string, type: Block["type"]) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  canEdit: boolean;
}) {
  return (
    <ul className="py-1.5 text-[0.78rem]">
      {rows.map(({ block, depth, canMoveUp, canMoveDown }) => {
        const isContainer = block.type === "root" || block.type === "container";
        const isSelected = selectedId === block.id;
        return (
          <li key={block.id}>
            <div
              className={`group flex items-center gap-1 pr-2 py-1 cursor-pointer ${
                isSelected ? "bg-cobalt/10" : "hover:bg-cream/60"
              }`}
              style={{ paddingLeft: `${0.75 + depth * 0.875}rem` }}
              onClick={() => onSelect(block.id)}
            >
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-ink-muted">
                {block.type}
              </span>
              <span className="ml-1.5 truncate text-[0.72rem] text-txt-secondary">
                {blockSummary(block)}
              </span>
              <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {canEdit && block.type !== "root" && (
                  <>
                    <IconButton
                      title="Move up"
                      disabled={!canMoveUp}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMove(block.id, -1);
                      }}
                    >↑</IconButton>
                    <IconButton
                      title="Move down"
                      disabled={!canMoveDown}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMove(block.id, 1);
                      }}
                    >↓</IconButton>
                    <IconButton
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete ${block.type}?`)) onRemove(block.id);
                      }}
                    >×</IconButton>
                  </>
                )}
              </span>
            </div>
            {canEdit && isContainer && (
              <div
                className="pb-1"
                style={{ paddingLeft: `${1.5 + depth * 0.875}rem` }}
              >
                <AddBlockPicker
                  onAdd={(type) => onAdd(block.id, type)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded text-[0.85rem] text-ink-muted hover:bg-ink/10 hover:text-charcoal disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
    >
      {children}
    </button>
  );
}

function AddBlockPicker({
  onAdd,
}: {
  onAdd: (type: Block["type"]) => void;
}) {
  return (
    <select
      value=""
      onChange={(e) => {
        const t = e.target.value as Block["type"];
        if (t) onAdd(t);
        e.target.value = "";
      }}
      className="h-6 rounded border border-dashed border-border bg-transparent px-1.5 text-[0.68rem] text-txt-muted hover:border-cobalt hover:text-cobalt cursor-pointer"
    >
      <option value="">+ Add block…</option>
      {ADDABLE_BLOCK_TYPES.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function blockSummary(block: Block): string {
  switch (block.type) {
    case "root":
      return block.bg.kind === "color" ? `bg ${block.bg.color.kind === "hex" ? block.bg.color.value : block.bg.color.token}` : "";
    case "container":
      return `max ${block.maxWidth}px`;
    case "heading":
      return block.text.kind === "static" ? block.text.value : block.text.field;
    case "eyebrow":
    case "rich_text":
      return block.text.kind === "static" ? block.text.value : block.text.field;
    case "meta_strip":
      return block.fields.map((f) => f.replace("campaign.", "")).join(" · ");
    case "salary_badge":
      return block.style;
    case "form_slot":
      return block.heading ?? "";
    case "footer":
      return block.text;
    case "divider":
      return `${block.thickness}px`;
    case "spacer":
      return `${block.height}rem`;
    case "logo_header":
      return `${block.logoHeight}px`;
  }
}

// ── Status transition buttons ──────────────────────────────────────

function TransitionButtons({
  status,
  onRequest,
  previewToken,
  linkCopied,
  onCopyLink,
}: {
  status: TemplateStatus;
  onRequest: (to: TemplateStatus) => void;
  previewToken: string | null;
  linkCopied: boolean;
  onCopyLink: () => void;
}) {
  const btn =
    "inline-flex h-8 items-center rounded-md px-3 text-[0.75rem] font-medium transition-colors cursor-pointer";
  const primary = `${btn} bg-cobalt text-ink hover:bg-cobalt-deep`;
  const secondary = `${btn} text-txt-secondary hover:bg-cream hover:text-charcoal`;
  const danger = `${btn} text-red hover:bg-red/10`;

  if (status === "draft") {
    return (
      <>
        <button onClick={() => onRequest("archived")} className={danger}>
          Archive
        </button>
        <button onClick={() => onRequest("pending")} className={primary}>
          Submit for review
        </button>
      </>
    );
  }
  if (status === "pending") {
    return (
      <>
        {previewToken && (
          <>
            <a
              href={`/preview/template/pending/${previewToken}`}
              target="_blank"
              rel="noreferrer"
              className={secondary}
            >
              Open preview ↗
            </a>
            <button
              type="button"
              onClick={onCopyLink}
              className={secondary}
              title="Copy preview link to clipboard"
            >
              {linkCopied ? "Copied!" : "Copy link"}
            </button>
          </>
        )}
        <button onClick={() => onRequest("draft")} className={secondary}>
          Send back to draft
        </button>
        <button onClick={() => onRequest("archived")} className={danger}>
          Archive
        </button>
        <button onClick={() => onRequest("published")} className={primary}>
          Approve &amp; publish
        </button>
      </>
    );
  }
  if (status === "published") {
    return (
      <>
        <button onClick={() => onRequest("archived")} className={danger}>
          Archive
        </button>
        <button onClick={() => onRequest("draft")} className={primary}>
          Edit (→ draft)
        </button>
      </>
    );
  }
  // archived
  return (
    <button onClick={() => onRequest("draft")} className={primary}>
      Revive (→ draft)
    </button>
  );
}

// ── Modal copy helpers ─────────────────────────────────────────────

function modalTitle(to: TemplateStatus | null): string {
  switch (to) {
    case "pending":
      return "Submit for client review?";
    case "published":
      return "Publish template?";
    case "archived":
      return "Archive this template?";
    case "draft":
      return "Move back to draft?";
    default:
      return "";
  }
}

function modalConfirmLabel(to: TemplateStatus | null): string {
  switch (to) {
    case "pending":
      return "Submit for review";
    case "published":
      return "Publish";
    case "archived":
      return "Archive";
    case "draft":
      return "Move to draft";
    default:
      return "Confirm";
  }
}

function modalBody(
  to: TemplateStatus | null,
  template: Template | null
): React.ReactNode {
  if (!template || !to) return null;
  const activeCount = template.active_campaign_count;
  switch (to) {
    case "pending":
      return (
        <>
          A new preview link will be generated and valid for 14 days. While
          pending, the template cannot be edited or selected by new campaigns.
        </>
      );
    case "published":
      return (
        <>
          The current block tree will be snapshotted and served to all live
          campaigns. A new thumbnail will be generated automatically.
        </>
      );
    case "archived":
      return (
        <>
          Archiving prevents new campaigns from selecting this template.
          {activeCount > 0 ? (
            <>
              {" "}
              <strong>{activeCount} active campaign{activeCount === 1 ? "" : "s"}</strong>{" "}
              currently use this template and will continue rendering the
              last-published snapshot.
            </>
          ) : (
            <> No live campaigns are using this template.</>
          )}
        </>
      );
    case "draft":
      if (template.status === "published") {
        return activeCount > 0 ? (
          <>
            Moving to draft lets you edit the block tree.{" "}
            <strong>{activeCount} active campaign{activeCount === 1 ? "" : "s"}</strong>{" "}
            will keep rendering the last-published snapshot — your edits
            won&apos;t affect them until you publish again.
          </>
        ) : (
          <>
            Moving to draft lets you edit the block tree. No live campaigns
            will be affected.
          </>
        );
      }
      return <>This will clear the preview token and move the template back to draft.</>;
    default:
      return null;
  }
}

// ── History panel ──────────────────────────────────────────────────

function HistoryPanel({
  entries,
  onClose,
}: {
  entries: HistoryEntry[] | null;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute right-0 top-10 z-50 w-[320px] rounded-lg border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            History
          </span>
          <button
            onClick={onClose}
            className="h-5 w-5 rounded text-ink-muted hover:bg-cream hover:text-charcoal cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ul className="max-h-[400px] overflow-auto py-1 text-[0.78rem]">
          {entries === null ? (
            <li className="px-3 py-3 text-txt-muted">Loading…</li>
          ) : entries.length === 0 ? (
            <li className="px-3 py-3 text-txt-muted">No history.</li>
          ) : (
            entries.map((e) => {
              const who = formatUser(e);
              const when = new Date(e.changed_at);
              return (
                <li
                  key={e.id}
                  className="border-b border-border/50 px-3 py-2 last:border-b-0"
                >
                  <div className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-ink-muted">
                    {e.from_status ?? "—"} → {e.to_status}
                  </div>
                  <div className="mt-0.5 text-txt-secondary">
                    {who} · {relativeTime(when)}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </>
  );
}

function formatUser(e: HistoryEntry): string {
  if (e.changed_by_first_name || e.changed_by_last_name) {
    return `${e.changed_by_first_name ?? ""} ${e.changed_by_last_name ?? ""}`.trim();
  }
  if (e.changed_by_email) return e.changed_by_email;
  return "system";
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}
