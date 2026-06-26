"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";

// NOTE (S8): this is the Members experience. The route is still /users (the
// nav label is "Members"); S14 completes the rename to /members. The legacy
// direct-create-user form is retired in favour of the invite flow.

interface MemberBrand {
  client_id: string;
  client_name: string;
  brand_role: string;
}

interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  org_role: string | null;
  is_active: boolean;
  created_at: string;
  memberships: MemberBrand[];
}

const ORG_ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  org_admin: "Org Admin",
};

const BRAND_ROLE_LABEL: Record<string, string> = {
  brand_admin: "Brand Admin",
  recruiter: "Recruiter",
  viewer: "Viewer",
};

const thClass =
  "px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

export default function MembersPage() {
  const router = useRouter();
  const tenant = useTenant();
  const canManage = canManageOrg(tenant);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((res) => setMembers(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Members</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {loading ? "Loading…" : `${members.length} member${members.length === 1 ? "" : "s"}`}
            {tenant.orgName ? ` · ${tenant.orgName}` : ""}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            Invite member
          </Button>
        )}
      </div>

      {/* Table / empty state */}
      {!loading && members.length === 0 ? (
        <EmptyState
          icon="candidates"
          title="No members yet"
          description={
            canManage
              ? "Invite a colleague to join your organisation. They'll set their own password from the invitation link."
              : "There are no other members to show yet."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-rule bg-surface">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule">
                {["Name", "Email", "Org role", "Brands", "Status"].map((h) => (
                  <th key={h} scope="col" className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-44" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  </tr>
                ))
              ) : (
                members.map((m) => (
                  <tr
                    key={m.id}
                    className="group cursor-pointer transition-colors hover:bg-canvas/70"
                    onClick={(e) => {
                      // Let the name link own keyboard / modifier clicks.
                      if ((e.target as HTMLElement).closest("a")) return;
                      router.push(`/users/${m.id}`);
                    }}
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/users/${m.id}`}
                        className="text-sm font-medium text-ink transition-colors group-hover:text-cobalt"
                      >
                        {m.first_name} {m.last_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-soft">
                      {m.email}
                    </td>
                    <td className="px-5 py-3">
                      {m.org_role ? (
                        <Badge tone="cobalt">{ORG_ROLE_LABEL[m.org_role] ?? m.org_role}</Badge>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-ink-soft">
                      <BrandCell member={m} />
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={m.is_active ? "moss" : "neutral"} dot>
                        {m.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            setInviteOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function BrandCell({ member }: { member: MemberRow }) {
  // An org-level owner/admin (org_role, no memberships) spans every brand.
  if (member.memberships.length === 0) {
    return member.org_role ? (
      <span className="text-ink-muted">All brands</span>
    ) : (
      <span className="text-ink-muted">—</span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {member.memberships.map((b) => (
        <span
          key={b.client_id}
          className="inline-flex items-center gap-1 rounded-md border border-rule bg-canvas px-1.5 py-0.5 text-[0.68rem]"
        >
          <span className="font-medium text-ink">{b.client_name}</span>
          <span className="text-ink-muted">
            {BRAND_ROLE_LABEL[b.brand_role] ?? b.brand_role}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Invite modal ─────────────────────────────────────────────────────

type AccessType = "brand" | "org";

function InviteModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: () => void;
}) {
  const tenant = useTenant();
  const { toast } = useToast();
  const canGrantOwner =
    tenant.orgRole === "owner" || (tenant.isOperator && tenant.actingOrgId !== null);

  const [email, setEmail] = useState("");
  const [accessType, setAccessType] = useState<AccessType>("brand");
  const [clientId, setClientId] = useState(tenant.brands[0]?.id ?? "");
  const [brandRole, setBrandRole] = useState("recruiter");
  const [orgRole, setOrgRole] = useState("org_admin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const noBrands = tenant.brands.length === 0;

  async function submit() {
    setError("");
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    const body =
      accessType === "brand"
        ? { email, clientId, brandRole }
        : { email, orgRole };

    if (accessType === "brand" && !clientId) {
      setError("Select a brand");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send invitation");
        return;
      }
      toast(`Invitation sent to ${email}`, "success");
      onInvited();
    } catch {
      setError("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Invite a member" size="md" dismissible={!submitting}>
      <p className="text-xs text-ink-muted">
        They&rsquo;ll receive an email to set a password and join your organisation.
      </p>

      <div className="mt-5 space-y-4">
        <Field label="Email" htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
          />
        </Field>

        {/* Access type toggle */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className={controlLabel}>Access</span>
            <HelpPopover label="About access types">
              <AccessHelp />
            </HelpPopover>
          </div>
          <div className="flex gap-1 rounded-lg border border-rule bg-canvas p-0.5">
            <SegBtn
              active={accessType === "brand"}
              onClick={() => setAccessType("brand")}
              label="Brand role"
            />
            <SegBtn
              active={accessType === "org"}
              onClick={() => setAccessType("org")}
              label="Org-level"
            />
          </div>
        </div>

        {accessType === "brand" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand" htmlFor="invite-brand">
              <Select
                id="invite-brand"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={noBrands}
              >
                {noBrands && <option value="">No brands yet</option>}
                {tenant.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <label htmlFor="invite-brand-role" className={controlLabel}>
                  Brand role
                </label>
                <HelpPopover label="About brand roles" align="right">
                  <BrandRolesHelp />
                </HelpPopover>
              </div>
              <Select
                id="invite-brand-role"
                value={brandRole}
                onChange={(e) => setBrandRole(e.target.value)}
              >
                <option value="brand_admin">Brand Admin</option>
                <option value="recruiter">Recruiter</option>
                <option value="viewer">Viewer</option>
              </Select>
            </div>
          </div>
        ) : (
          <Field
            label="Org role"
            htmlFor="invite-org-role"
            helper="Org-level members can manage every brand in the organisation."
          >
            <Select
              id="invite-org-role"
              value={orgRole}
              onChange={(e) => setOrgRole(e.target.value)}
            >
              <option value="org_admin">Org Admin</option>
              {canGrantOwner && <option value="owner">Owner</option>}
            </Select>
          </Field>
        )}

        {error && <Callout tone="error">{error}</Callout>}
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          loading={submitting}
          disabled={accessType === "brand" && noBrands}
        >
          Send invitation
        </Button>
      </div>
    </Modal>
  );
}

function SegBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-md px-3 py-1.5 text-[0.75rem] font-medium transition-colors cursor-pointer ${
        active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink-soft"
      }`}
    >
      {label}
    </button>
  );
}

// ── Help popovers (invite affordances) ───────────────────────────────
// A small "?" trigger that opens an on-demand explanation. Rendered INSIDE the
// invite modal card so its click-away dismisses the popover without bubbling to
// the modal's overlay-close.

function HelpPopover({
  label,
  align = "left",
  children,
}: {
  label: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-rule text-[0.62rem] font-semibold leading-none text-ink-muted transition-colors hover:border-cobalt hover:text-cobalt cursor-pointer"
      >
        ?
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={label}
            className={`absolute top-6 z-20 w-72 rounded-lg border border-rule bg-surface p-3.5 text-left shadow-xl ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}

function HelpItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <p className="text-[0.72rem] leading-relaxed text-ink-soft">
      <span className="font-semibold text-ink">{term}</span> — {children}
    </p>
  );
}

function BrandRolesHelp() {
  return (
    <div className="space-y-2">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        What each brand role can do
      </p>
      <HelpItem term="Brand Admin">
        Everything a Recruiter can do, plus edit this brand&rsquo;s branding,
        contact details, and settings.
      </HelpItem>
      <HelpItem term="Recruiter">
        Add and manage candidates, and create, edit, and publish campaigns for
        this brand.
      </HelpItem>
      <HelpItem term="Viewer">
        Read-only access to this brand&rsquo;s campaigns and candidates.
      </HelpItem>
    </div>
  );
}

function AccessHelp() {
  return (
    <div className="space-y-2">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        Brand role vs Org-level
      </p>
      <HelpItem term="Brand role">
        Access to a single brand, at the level you choose. Best for someone who
        works on just one brand.
      </HelpItem>
      <HelpItem term="Org-level">
        Access to every brand in the organisation, plus organisation admin —
        inviting members, creating brands, and editing settings. Best for
        someone who runs the whole account.
      </HelpItem>
      <p className="text-[0.7rem] leading-relaxed text-ink-muted">
        Org-level comes as Org Admin, or Owner (full control, including managing
        other owners).
      </p>
    </div>
  );
}

const controlLabel = "text-[0.8rem] font-medium text-ink-soft";
