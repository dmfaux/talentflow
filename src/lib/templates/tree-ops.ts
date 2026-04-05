// ── Tree manipulation utilities ────────────────────────────────────
//
// Immutable updates over a BlockTree for the editor. Every function
// returns a new tree — React relies on referential inequality to
// detect changes.

import type {
  Block,
  BlockTree,
  ContainerBlock,
  RootBlock,
  Typography,
} from "@/templates/blocks/schema";

// ── Block id generation ────────────────────────────────────────────

/**
 * Return a short, readable id not currently used in the tree. Uses
 * the block type as a prefix plus a short random suffix.
 */
export function generateBlockId(type: Block["type"], tree: BlockTree): string {
  const used = new Set<string>();
  walk(tree.root, (b) => used.add(b.id));
  for (let attempt = 0; attempt < 50; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const id = `${type}_${suffix}`;
    if (!used.has(id)) return id;
  }
  // Fallback — astronomically unlikely after 50 attempts.
  return `${type}_${Date.now().toString(36)}`;
}

// ── Walks / finders ────────────────────────────────────────────────

export function walk(block: Block, visit: (b: Block) => void): void {
  visit(block);
  if (block.type === "root" || block.type === "container") {
    for (const c of block.children) walk(c, visit);
  }
}

export function findBlock(tree: BlockTree, id: string): Block | null {
  let found: Block | null = null;
  walk(tree.root, (b) => {
    if (b.id === id) found = b;
  });
  return found;
}

/** Return the parent container holding `childId`, or null if childId is root. */
export function findParent(
  tree: BlockTree,
  childId: string
): RootBlock | ContainerBlock | null {
  let parent: RootBlock | ContainerBlock | null = null;
  walk(tree.root, (b) => {
    if (b.type === "root" || b.type === "container") {
      for (const c of b.children) if (c.id === childId) parent = b;
    }
  });
  return parent;
}

// ── Immutable container updater ────────────────────────────────────

/**
 * Re-create the tree, replacing whichever container holds the block
 * path with `mapChildren` applied. Internal helper for add/remove/move.
 */
function mapContainer(
  root: RootBlock,
  containerId: string,
  mapChildren: (children: Block[]) => Block[]
): RootBlock {
  const rebuild = (b: Block): Block => {
    if (b.type === "root" || b.type === "container") {
      const nextChildren =
        b.id === containerId
          ? mapChildren(b.children)
          : b.children.map(rebuild);
      return { ...b, children: nextChildren } as Block;
    }
    return b;
  };
  return rebuild(root) as RootBlock;
}

// ── Operations ──────────────────────────────────────────────────────

export function addBlock(
  tree: BlockTree,
  parentId: string,
  block: Block,
  insertAt?: number
): BlockTree {
  const root = mapContainer(tree.root, parentId, (children) => {
    const at = insertAt ?? children.length;
    const next = children.slice();
    next.splice(at, 0, block);
    return next;
  });
  return { ...tree, root };
}

export function removeBlock(tree: BlockTree, id: string): BlockTree {
  const parent = findParent(tree, id);
  if (!parent) return tree; // don't remove the root
  const root = mapContainer(tree.root, parent.id, (children) =>
    children.filter((c) => c.id !== id)
  );
  return { ...tree, root };
}

/** Move a block up (-1) or down (+1) within its parent container. */
export function moveBlock(
  tree: BlockTree,
  id: string,
  delta: -1 | 1
): BlockTree {
  const parent = findParent(tree, id);
  if (!parent) return tree;
  const idx = parent.children.findIndex((c) => c.id === id);
  if (idx < 0) return tree;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= parent.children.length) return tree;
  const root = mapContainer(tree.root, parent.id, (children) => {
    const next = children.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(newIdx, 0, moved);
    return next;
  });
  return { ...tree, root };
}

/**
 * Replace the block with `id` (anywhere in the tree) with the result
 * of applying `patcher`. `patcher` must return a block of the same
 * type — we don't allow changing block.type mid-tree.
 */
export function updateBlock<T extends Block>(
  tree: BlockTree,
  id: string,
  patcher: (block: T) => T
): BlockTree {
  const rebuild = (b: Block): Block => {
    if (b.id === id) {
      return patcher(b as T);
    }
    if (b.type === "root" || b.type === "container") {
      return { ...b, children: b.children.map(rebuild) } as Block;
    }
    return b;
  };
  return { ...tree, root: rebuild(tree.root) as RootBlock };
}

// ── Default block factories ────────────────────────────────────────
//
// Used by the "add block" picker in the editor.

const DEFAULT_TYPOGRAPHY_SANS: Typography = {
  family: "sans",
  weight: 400,
  size: 1,
  italic: false,
  lineHeight: 1.5,
  letterSpacing: 0,
  uppercase: false,
  color: { kind: "hex", value: "#0b0f1c" },
};

const DEFAULT_TYPOGRAPHY_SERIF: Typography = {
  family: "serif",
  weight: 500,
  size: 2.25,
  italic: false,
  lineHeight: 1.15,
  letterSpacing: -0.01,
  uppercase: false,
  color: { kind: "brand", token: "primary" },
};

const DEFAULT_TYPOGRAPHY_EYEBROW: Typography = {
  family: "sans",
  weight: 600,
  size: 0.72,
  italic: false,
  lineHeight: 1.4,
  letterSpacing: 0.1,
  uppercase: true,
  color: { kind: "hex", value: "#58607a" },
};

export function makeDefaultBlock(
  type: Block["type"],
  id: string
): Block {
  switch (type) {
    case "root":
      return {
        id,
        type: "root",
        bg: { kind: "color", color: { kind: "hex", value: "#ffffff" } },
        children: [],
      };
    case "container":
      return {
        id,
        type: "container",
        maxWidth: 720,
        padding: { top: 2.5, right: 1.5, bottom: 2.5, left: 1.5 },
        align: "center",
        children: [],
      };
    case "logo_header":
      return {
        id,
        type: "logo_header",
        logoHeight: 64,
        showClientName: true,
        align: "left",
        clientNameTypography: DEFAULT_TYPOGRAPHY_EYEBROW,
      };
    case "heading":
      return {
        id,
        type: "heading",
        level: 1,
        text: { kind: "bind", field: "campaign.role_title" },
        typography: DEFAULT_TYPOGRAPHY_SERIF,
        align: "left",
        maxWidth: null,
      };
    case "eyebrow":
      return {
        id,
        type: "eyebrow",
        text: { kind: "static", value: "Now hiring" },
        typography: DEFAULT_TYPOGRAPHY_EYEBROW,
        align: "left",
      };
    case "meta_strip":
      return {
        id,
        type: "meta_strip",
        style: "dots",
        fields: [
          "campaign.department",
          "campaign.location",
          "campaign.employment_type",
        ],
        typography: { ...DEFAULT_TYPOGRAPHY_EYEBROW, uppercase: true },
        align: "left",
      };
    case "salary_badge":
      return {
        id,
        type: "salary_badge",
        style: "chip",
        typography: { ...DEFAULT_TYPOGRAPHY_SANS, size: 0.85 },
        align: "left",
      };
    case "rich_text":
      return {
        id,
        type: "rich_text",
        text: { kind: "bind", field: "campaign.role_description" },
        emptyFallback: "Full role details will be shared at the next stage.",
        typography: { ...DEFAULT_TYPOGRAPHY_SANS, lineHeight: 1.65 },
        align: "left",
        maxWidth: null,
      };
    case "form_slot":
      return {
        id,
        type: "form_slot",
        heading: "Apply for this role",
        subheading: null,
        cardStyle: "bordered",
      };
    case "divider":
      return {
        id,
        type: "divider",
        color: { kind: "hex", value: "#e5e7eb" },
        thickness: 1,
        inset: 0,
      };
    case "spacer":
      return { id, type: "spacer", height: 1.5 };
    case "footer":
      return {
        id,
        type: "footer",
        text: "POPIA compliant",
        typography: { ...DEFAULT_TYPOGRAPHY_EYEBROW, uppercase: true, size: 0.7 },
        align: "center",
        showPoweredBy: true,
      };
  }
}

/** A minimal tree that satisfies schema (one root, one form_slot). */
export function makeStarterTree(): BlockTree {
  return {
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
            makeDefaultBlock("logo_header", "logo"),
            makeDefaultBlock("heading", "title"),
            makeDefaultBlock("meta_strip", "meta"),
            makeDefaultBlock("rich_text", "desc"),
            makeDefaultBlock("form_slot", "form"),
            makeDefaultBlock("footer", "footer"),
          ],
        },
      ],
    },
  };
}
