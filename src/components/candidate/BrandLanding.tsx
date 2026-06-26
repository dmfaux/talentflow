import Link from "next/link";
import type {
  ActiveFilters,
  BrandLandingResult,
  RoleListItem,
} from "@/lib/brand-landing";

// Public per-brand careers landing. A server component: it adopts the brand's
// resolved palette by writing CSS custom properties onto its root and driving
// every colour from them, so filters, role rows and pagination are plain links
// with pure-CSS hover/focus — no client JS, fully crawlable and no-JS friendly.

type OkData = Extract<BrandLandingResult, { kind: "ok" }>;

const zar = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});
const dateFmt = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatSalary(min: number | null, max: number | null): string | null {
  if (min && max) return `${zar.format(min)} – ${zar.format(max)}`;
  if (min) return `From ${zar.format(min)}`;
  if (max) return `Up to ${zar.format(max)}`;
  return null;
}

/** Build a /c/[slug] URL from a filter+page state, omitting empty params. */
function hrefWith(
  slug: string,
  state: Partial<ActiveFilters> & { page?: number },
): string {
  const sp = new URLSearchParams();
  if (state.department) sp.set("dept", state.department);
  if (state.location) sp.set("loc", state.location);
  if (state.employmentType) sp.set("type", state.employmentType);
  if (state.page && state.page > 1) sp.set("page", String(state.page));
  const q = sp.toString();
  return q ? `/c/${slug}?${q}` : `/c/${slug}`;
}

/** Page tokens with ellipses: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(current: number, total: number): (number | "…")[] {
  const keep = new Set<number>([1, total, current - 1, current, current + 1]);
  const shown = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of shown) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

const SCOPED_CSS = `
.bl-root{background:var(--bl-bg);color:var(--bl-ink);font-family:var(--bl-font-sans);}
.bl-display{font-family:var(--bl-font-display);}
.bl-role-title{transition:color .25s ease;}
.bl-role:hover .bl-role-title{color:var(--bl-primary);}
.bl-arrow{transition:transform .3s cubic-bezier(.22,1,.36,1);}
.bl-role:hover .bl-arrow{transform:translateX(5px);}
.bl-facet{transition:color .2s ease,border-color .2s ease;}
.bl-facet:hover{border-color:var(--bl-primary);color:var(--bl-primary);}
.bl-pagelink{transition:border-color .2s ease,color .2s ease;}
.bl-pagelink:hover{border-color:var(--bl-primary);color:var(--bl-primary);}
.bl-textlink{background-image:linear-gradient(currentColor,currentColor);background-size:0% 1px;background-position:0 100%;background-repeat:no-repeat;transition:background-size .35s cubic-bezier(.22,1,.36,1);}
.bl-textlink:hover{background-size:100% 1px;}
.bl-root a:focus-visible{outline:2px solid var(--bl-primary);outline-offset:3px;border-radius:4px;}
.bl-excerpt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
`;

export function BrandLanding({ data }: { data: OkData }) {
  const { brand, theme, roles, facets, filters, totalOpen, totalFiltered, page, totalPages } =
    data;
  const p = theme.palette;
  const slug = brand.slug;

  const rootStyle = {
    "--bl-bg": p.bg,
    "--bl-card": p.card,
    "--bl-ink": p.ink,
    "--bl-ink-soft": p.inkSoft,
    "--bl-ink-muted": p.inkMuted,
    "--bl-ink-faint": p.inkFaint,
    "--bl-border": p.border,
    "--bl-primary": p.primary,
    "--bl-on-primary": theme.onPrimary,
    "--bl-font-display": theme.fontDisplay,
    "--bl-font-sans": theme.fontSans,
  } as React.CSSProperties;

  const teamCount = facets.department.length;
  const countLine =
    totalOpen === 0
      ? "No roles are open right now."
      : `${totalOpen} ${totalOpen === 1 ? "position" : "positions"} open` +
        (teamCount > 1 ? ` across ${teamCount} teams.` : ".");

  const anyFilters =
    facets.department.length + facets.location.length + facets.employmentType.length > 0;

  return (
    <main
      className="bl-root min-h-screen"
      style={rootStyle}
    >
      {theme.fontImports.map((url) => (
        <link key={url} rel="stylesheet" href={url} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />

      <div className="mx-auto w-full max-w-3xl px-6 py-14 sm:py-20">
        {/* ── Masthead ── */}
        <header>
          <div className="flex items-start justify-between gap-4">
            <BrandLogo logo={theme.logo} name={brand.name} />
            {totalOpen > 0 && (
              <span
                className="mt-1 inline-flex shrink-0 items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--bl-ink-muted)" }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--bl-primary)" }}
                  aria-hidden
                />
                Now hiring
              </span>
            )}
          </div>

          <p
            className="mt-10 text-[0.7rem] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--bl-ink-muted)" }}
          >
            Careers
          </p>
          <h1 className="bl-display mt-3 text-4xl leading-[1.05] sm:text-5xl">
            Open roles at {brand.name}
          </h1>
          <p className="mt-4 text-base" style={{ color: "var(--bl-ink-soft)" }}>
            {countLine}
          </p>
          <div
            className="mt-7 h-[3px] w-14 rounded-full"
            style={{ backgroundColor: "var(--bl-primary)" }}
          />
        </header>

        {totalOpen === 0 ? (
          <EmptyState
            title="No open roles right now"
            body={`${brand.name} isn't hiring at the moment. New roles are posted here — check back soon.`}
          />
        ) : (
          <>
            {anyFilters && (
              <section aria-label="Filter roles" className="mt-12 space-y-3">
                <FacetGroup
                  label="Department"
                  values={facets.department}
                  active={filters.department}
                  hrefFor={(v) =>
                    hrefWith(slug, { ...filters, department: v, page: 1 })
                  }
                  clearHref={hrefWith(slug, { ...filters, department: null, page: 1 })}
                />
                <FacetGroup
                  label="Location"
                  values={facets.location}
                  active={filters.location}
                  hrefFor={(v) =>
                    hrefWith(slug, { ...filters, location: v, page: 1 })
                  }
                  clearHref={hrefWith(slug, { ...filters, location: null, page: 1 })}
                />
                <FacetGroup
                  label="Type"
                  values={facets.employmentType}
                  active={filters.employmentType}
                  hrefFor={(v) =>
                    hrefWith(slug, { ...filters, employmentType: v, page: 1 })
                  }
                  clearHref={hrefWith(slug, {
                    ...filters,
                    employmentType: null,
                    page: 1,
                  })}
                />
              </section>
            )}

            {totalFiltered === 0 ? (
              <EmptyState
                title="No roles match these filters"
                body="Try widening your search."
                action={{ href: hrefWith(slug, { page: 1 }), label: "Clear filters" }}
              />
            ) : (
              <ul className="mt-10 border-t" style={{ borderColor: "var(--bl-border)" }}>
                {roles.map((role) => (
                  <RoleRow key={role.slug} role={role} slug={slug} />
                ))}
              </ul>
            )}

            {totalPages > 1 && (
              <Pager slug={slug} filters={filters} page={page} totalPages={totalPages} />
            )}
          </>
        )}

        {theme.showPoweredBy && (
          <footer
            className="mt-16 text-center text-xs"
            style={{ color: "var(--bl-ink-muted)" }}
          >
            <Link href="/" className="bl-textlink">
              Powered by TalentStream
            </Link>
          </footer>
        )}
      </div>
    </main>
  );
}

function BrandLogo({
  logo,
  name,
}: {
  logo: OkData["theme"]["logo"];
  name: string;
}) {
  if (!logo) {
    // No logo configured → the headline carries the brand name; render nothing
    // here rather than a placeholder.
    return <span aria-hidden />;
  }
  const onDark = logo.background === "dark";
  return (
    <span
      className="inline-flex items-center"
      style={
        onDark
          ? {
              backgroundColor: "var(--bl-ink)",
              padding: "8px 12px",
              borderRadius: 8,
            }
          : undefined
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logo.url}
        alt={name}
        style={{ display: "block", height: 40, width: "auto", maxWidth: 180 }}
      />
    </span>
  );
}

function FacetGroup({
  label,
  values,
  active,
  hrefFor,
  clearHref,
}: {
  label: string;
  values: string[];
  active: string | null;
  hrefFor: (value: string) => string;
  clearHref: string;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
      <span
        className="shrink-0 pt-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.14em] sm:w-24"
        style={{ color: "var(--bl-ink-muted)" }}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        <FacetChip href={clearHref} active={active === null}>
          All
        </FacetChip>
        {values.map((v) => (
          <FacetChip
            key={v}
            href={active === v ? clearHref : hrefFor(v)}
            active={active === v}
          >
            {v}
          </FacetChip>
        ))}
      </div>
    </div>
  );
}

function FacetChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        "rounded-full border px-3 py-1 text-sm" + (active ? "" : " bl-facet")
      }
      style={
        active
          ? {
              backgroundColor: "var(--bl-primary)",
              borderColor: "var(--bl-primary)",
              color: "var(--bl-on-primary)",
            }
          : { borderColor: "var(--bl-border)", color: "var(--bl-ink-soft)" }
      }
    >
      {children}
    </Link>
  );
}

function RoleRow({ role, slug }: { role: RoleListItem; slug: string }) {
  const meta = [role.department, role.location, role.employmentType].filter(
    Boolean,
  ) as string[];
  const salary = formatSalary(role.salaryMin, role.salaryMax);

  return (
    <li className="border-b" style={{ borderColor: "var(--bl-border)" }}>
      <Link href={`/c/${slug}/${role.slug}`} className="bl-role group block py-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {meta.length > 0 && (
              <p
                className="text-[0.7rem] font-semibold uppercase tracking-[0.12em]"
                style={{ color: "var(--bl-ink-muted)" }}
              >
                {meta.join("  ·  ")}
              </p>
            )}
            <h2 className="bl-role-title bl-display mt-1.5 text-2xl leading-tight sm:text-[1.7rem]">
              {role.roleTitle}
            </h2>
            {salary && (
              <p
                className="mt-2 text-sm font-medium"
                style={{ color: "var(--bl-ink-soft)" }}
              >
                {salary}
              </p>
            )}
            {role.excerpt && (
              <p
                className="bl-excerpt mt-2 max-w-prose text-sm leading-relaxed"
                style={{ color: "var(--bl-ink-muted)" }}
              >
                {role.excerpt}
              </p>
            )}
            {role.closesAt && (
              <p
                className="mt-3 text-xs"
                style={{ color: "var(--bl-ink-faint)" }}
              >
                Closes {dateFmt.format(role.closesAt)}
              </p>
            )}
          </div>
          <span
            className="bl-arrow mt-1 shrink-0 text-xl"
            style={{ color: "var(--bl-primary)" }}
            aria-hidden
          >
            →
          </span>
        </div>
      </Link>
    </li>
  );
}

function Pager({
  slug,
  filters,
  page,
  totalPages,
}: {
  slug: string;
  filters: ActiveFilters;
  page: number;
  totalPages: number;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex flex-wrap items-center justify-center gap-2"
    >
      <PageLink
        href={hrefWith(slug, { ...filters, page: page - 1 })}
        disabled={page <= 1}
        rel="prev"
      >
        ‹ Prev
      </PageLink>
      {pageWindow(page, totalPages).map((tok, i) =>
        tok === "…" ? (
          <span
            key={`gap-${i}`}
            className="px-2 text-sm"
            style={{ color: "var(--bl-ink-faint)" }}
          >
            …
          </span>
        ) : (
          <PageLink
            key={tok}
            href={hrefWith(slug, { ...filters, page: tok })}
            active={tok === page}
          >
            {tok}
          </PageLink>
        ),
      )}
      <PageLink
        href={hrefWith(slug, { ...filters, page: page + 1 })}
        disabled={page >= totalPages}
        rel="next"
      >
        Next ›
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  children,
  active = false,
  disabled = false,
  rel,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  rel?: string;
}) {
  const base =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={base + " cursor-not-allowed opacity-40"}
        style={{ borderColor: "var(--bl-border)", color: "var(--bl-ink-muted)" }}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      rel={rel}
      aria-current={active ? "page" : undefined}
      className={base + (active ? "" : " bl-pagelink")}
      style={
        active
          ? {
              backgroundColor: "var(--bl-primary)",
              borderColor: "var(--bl-primary)",
              color: "var(--bl-on-primary)",
            }
          : { borderColor: "var(--bl-border)", color: "var(--bl-ink-soft)" }
      }
    >
      {children}
    </Link>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div
      className="mt-12 rounded-xl border px-8 py-16 text-center"
      style={{ borderColor: "var(--bl-border)", backgroundColor: "var(--bl-card)" }}
    >
      <h2 className="bl-display text-2xl" style={{ color: "var(--bl-ink)" }}>
        {title}
      </h2>
      <p
        className="mx-auto mt-3 max-w-md text-sm leading-relaxed"
        style={{ color: "var(--bl-ink-muted)" }}
      >
        {body}
      </p>
      {action && (
        <Link
          href={action.href}
          className="bl-textlink mt-5 inline-block text-sm font-medium"
          style={{ color: "var(--bl-primary)" }}
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
