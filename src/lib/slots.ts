// ── HTML template slot validation and replacement ───────────────────
//
// Templates use mustache-style {{slot.name}} markers for dynamic
// campaign data that gets replaced at render time. The form area uses
// a literal <div id="application-form"></div> element that becomes
// a React portal mount point.

// ── Slot allow-list ────────────────────────────────────────────────

export const SLOT_ALLOW_LIST = [
  "client.name",
  "campaign.role_title",
  "campaign.role_description",
  "campaign.department",
  "campaign.location",
  "campaign.employment_type",
  "campaign.salary_range",
  // Legacy separate slots — still accepted for backwards compatibility
  "campaign.salary_range_min",
  "campaign.salary_range_max",
] as const;

export type SlotName = (typeof SLOT_ALLOW_LIST)[number];

const SLOT_SET = new Set<string>(SLOT_ALLOW_LIST);

/** Slots that contain pre-rendered HTML (from markdown) and must not be escaped. */
const RAW_HTML_SLOTS = new Set<string>([
  "campaign.role_description",
]);

// ── Slot data for replacement ──────────────────────────────────────

export interface SlotData {
  client: {
    name: string;
  };
  campaign: {
    role_title: string;
    role_description?: string | null;
    department?: string | null;
    location?: string | null;
    employment_type?: string | null;
    salary_range_min?: number | null;
    salary_range_max?: number | null;
  };
}

// ── Validation ─────────────────────────────────────────────────────

const SLOT_REGEX = /\{\{([^}]+)\}\}/g;
const FORM_DIV_REGEX = /<div\s+id\s*=\s*["']application-form["']\s*>\s*<\/div>/i;
const SCRIPT_REGEX = /<script[\s>]/i;

export function validateHtmlTemplate(
  html: string
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!html.trim()) {
    errors.push("HTML template is empty");
    return { ok: false, errors };
  }

  // Must contain form mount point
  if (!FORM_DIV_REGEX.test(html)) {
    errors.push(
      'Template must contain <div id="application-form"></div> where the form will be rendered'
    );
  }

  // No script tags (form logic is handled by ApplicationForm)
  if (SCRIPT_REGEX.test(html)) {
    errors.push(
      "Template must not contain <script> tags — form handling is managed by the application"
    );
  }

  // All {{...}} slots must be from the allow-list
  // Block delimiters {{#name}} and {{/name}} reference the same slots
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(SLOT_REGEX.source, "g");
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    const name = raw.replace(/^[#/]/, "");
    if (!SLOT_SET.has(name) && !seen.has(name)) {
      errors.push(
        `Unknown slot "{{${raw}}}". Allowed: ${SLOT_ALLOW_LIST.join(", ")}`
      );
    }
    seen.add(name);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── Replacement ────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format a number as ZAR currency (e.g. 450000 → "R 450,000"). */
function formatZar(n: number): string {
  return "R " + n.toLocaleString("en-ZA");
}

/**
 * Build the salary range string from min/max.
 * - Both set:    "R 450,000 – R 650,000"
 * - Only min:    "From R 450,000"
 * - Only max:    "Up to R 650,000"
 * - Neither:     ""
 */
function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  if (min && max) return `${formatZar(min)} – ${formatZar(max)}`;
  if (min) return `From ${formatZar(min)}`;
  if (max) return `Up to ${formatZar(max)}`;
  return "";
}

const SALARY_FORMAT_SLOTS = new Set<string>([
  "campaign.salary_range_min",
  "campaign.salary_range_max",
]);

function resolveSlot(name: string, data: SlotData): string {
  // Combined salary range slot
  if (name === "campaign.salary_range") {
    return escapeHtml(
      formatSalaryRange(data.campaign.salary_range_min, data.campaign.salary_range_max)
    );
  }

  // Legacy separate salary slots — format as ZAR
  if (SALARY_FORMAT_SLOTS.has(name)) {
    const key = name === "campaign.salary_range_min" ? "salary_range_min" : "salary_range_max";
    const val = data.campaign[key];
    if (val === null || val === undefined) return "";
    return escapeHtml(formatZar(val));
  }

  const [ns, key] = name.split(".", 2);
  const obj = ns === "client" ? data.client : ns === "campaign" ? data.campaign : undefined;
  if (!obj) return "";
  const raw = (obj as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return "";
  return RAW_HTML_SLOTS.has(name) ? String(raw) : escapeHtml(String(raw));
}

// ── Conditional blocks ─────────────────────────────────────────────
//
// {{#slot.name}} ... {{/slot.name}} blocks are removed entirely when
// the slot resolves to an empty string (null/undefined/missing data).
// When the slot has a value the delimiters are stripped and inner
// content (including nested {{slot.name}} markers) is kept.

const BLOCK_REGEX = /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

function resolveBlockValue(name: string, data: SlotData): string {
  return resolveSlot(name.trim(), data);
}

export function replaceSlots(html: string, data: SlotData): string {
  // 1. Process conditional blocks first — strip empty, keep non-empty
  let result = html.replace(BLOCK_REGEX, (_, name: string, inner: string) => {
    const value = resolveBlockValue(name, data);
    return value ? inner : "";
  });

  // 2. Replace remaining standalone slot markers
  result = result.replace(SLOT_REGEX, (_, name: string) =>
    resolveSlot(name.trim(), data)
  );

  return result;
}
