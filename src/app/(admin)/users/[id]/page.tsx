"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { useToast } from "@/components/ui/toast-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Field, Input, Select } from "@/components/ui/field";

interface MemberBrand {
  client_id: string;
  client_name: string;
  brand_role: string;
}

interface UserRecord {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  org_role: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

const dtClass =
  "text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const tenant = useTenant();
  const canManage = canManageOrg(tenant);
  // Mirrors the invite modal: only an owner (or an acting operator) may grant or
  // change the Owner role; an org_admin tops out at org_admin.
  const canGrantOwner =
    tenant.orgRole === "owner" || (tenant.isOperator && tenant.actingOrgId !== null);

  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [resettingPwd, setResettingPwd] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState("");

  // Brand-access editor (brand-scoped members only).
  const [addClientId, setAddClientId] = useState("");
  const [addBrandRole, setAddBrandRole] = useState("recruiter");
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipError, setMembershipError] = useState("");

  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  // Re-fetch (not setLoading) so brand-access mutations refresh in place without
  // flashing the whole page back to its loading state.
  const load = useCallback(() => {
    fetch(`/api/admin/users/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((res) => setUser(res.data))
      .catch(() => setLoadError("User not found"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError("");
    setSaving(true);

    const form = new FormData(e.currentTarget);
    const firstName = (form.get("firstName") as string).trim();
    const lastName = (form.get("lastName") as string).trim();
    const email = (form.get("email") as string).trim();
    const orgRole = form.get("orgRole") as string; // "" = Member (brand-scoped)
    const isActive = form.get("isActive") === "on";

    if (!firstName || !lastName || !email) {
      setSaveError("First name, last name and email are required");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, orgRole, isActive }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || "Failed to save");
        return;
      }

      // Refetch rather than merge the PATCH response: promoting a Member to an
      // org-level role clears their memberships server-side, so the Brand access
      // section must reload to reflect it.
      setEditing(false);
      load();
    } catch {
      setSaveError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function addMembership(clientId: string, brandRole: string) {
    if (!clientId) return;
    setMembershipError("");
    setMembershipBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${id}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, brandRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMembershipError(data.error || "Failed to add brand");
        return;
      }
      setAddClientId("");
      load();
    } catch {
      setMembershipError("Something went wrong");
    } finally {
      setMembershipBusy(false);
    }
  }

  async function removeMembership(clientId: string) {
    setMembershipError("");
    setMembershipBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${id}/memberships/${clientId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setMembershipError(data.error || "Failed to remove brand");
        return;
      }
      load();
    } catch {
      setMembershipError("Something went wrong");
    } finally {
      setMembershipBusy(false);
    }
  }

  async function handlePasswordReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwdError("");

    const form = new FormData(e.currentTarget);
    const password = form.get("password") as string;
    const confirmPassword = form.get("confirmPassword") as string;

    if (password !== confirmPassword) {
      setPwdError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setPwdError("Password must be at least 8 characters");
      return;
    }

    setPwdSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        setPwdError(data.error || "Failed to reset password");
        return;
      }

      setResettingPwd(false);
      toast("Password updated", "success");
    } catch {
      setPwdError("Something went wrong");
    } finally {
      setPwdSaving(false);
    }
  }

  async function runDeactivate() {
    setDeactivating(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast("Failed to deactivate user", "error");
        return;
      }
      router.push("/users");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setDeactivating(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        <Skeleton className="mb-6 h-4 w-32" />
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-16" />
          </div>
        </div>
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="mt-6 h-36 rounded-xl" />
      </div>
    );
  }

  if (loadError || !user) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center">
        <p className="text-sm font-medium text-ink">{loadError || "User not found"}</p>
        <p className="mt-1 text-sm text-ink-muted">
          This user may have been removed, or you don&rsquo;t have access to them.
        </p>
        <Link
          href="/users"
          className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-5`}
        >
          Back to users
        </Link>
      </div>
    );
  }

  const orgRoleLabel = user.org_role
    ? ORG_ROLE_LABEL[user.org_role] ?? user.org_role
    : "Member";

  // Brands not yet assigned to this member — the pool for the "Add brand" select.
  const availableBrands = tenant.brands.filter(
    (b) => !user.memberships.some((m) => m.client_id === b.id)
  );
  const selectedAddBrand =
    availableBrands.find((b) => b.id === addClientId)?.id ?? availableBrands[0]?.id ?? "";

  return (
    <div className="mx-auto max-w-3xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/users" className="transition-colors hover:text-ink">
          Users
        </Link>
        <span>/</span>
        <span className="text-ink-soft">
          {user.first_name} {user.last_name}
        </span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {user.first_name} {user.last_name}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-muted">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setResettingPwd(true)}>
            Reset password
          </Button>
          <Button onClick={() => setEditing(true)}>Edit</Button>
        </div>
      </div>

      {/* Info card */}
      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
          <div>
            <dt className={dtClass}>Email</dt>
            <dd className="mt-1 font-mono text-xs text-ink">{user.email}</dd>
          </div>
          <div>
            <dt className={dtClass}>Org role</dt>
            <dd className="mt-1 text-sm text-ink">{orgRoleLabel}</dd>
          </div>
          <div>
            <dt className={dtClass}>Status</dt>
            <dd className="mt-1.5">
              <Badge tone={user.is_active ? "moss" : "neutral"} dot>
                {user.is_active ? "Active" : "Inactive"}
              </Badge>
            </dd>
          </div>
        </dl>
      </Card>

      {/* Brand access */}
      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-ink">Brand access</h2>

        {user.org_role ? (
          <p className="mt-3 text-sm text-ink-soft">
            <span className="font-medium text-ink">All brands.</span> Org-level{" "}
            {orgRoleLabel.toLowerCase()}s can manage every brand in the organisation.
            To scope this person to specific brands, change their role to{" "}
            <span className="font-medium text-ink">Member</span>.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-muted">
              Brands this member can act in. Each can carry its own role.
            </p>

            <div className="mt-4">
              {user.memberships.length === 0 ? (
                <p className="text-sm text-ink-muted">No brands assigned yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {user.memberships.map((m) => (
                    <span
                      key={m.client_id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-canvas/60 px-2.5 py-1 text-xs"
                    >
                      <span className="font-medium text-ink">{m.client_name}</span>
                      <span className="text-ink-muted">
                        {BRAND_ROLE_LABEL[m.brand_role] ?? m.brand_role}
                      </span>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => removeMembership(m.client_id)}
                          disabled={membershipBusy}
                          aria-label={`Remove ${m.client_name}`}
                          className="ml-0.5 text-ink-muted transition-colors hover:text-red cursor-pointer disabled:opacity-50"
                        >
                          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M3 3l8 8M11 3l-8 8" />
                          </svg>
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {canManage && availableBrands.length > 0 && (
              <div className="mt-5 flex items-end gap-2 border-t border-rule pt-5">
                <Field label="Add brand" htmlFor="add-brand" className="flex-1">
                  <Select
                    id="add-brand"
                    value={selectedAddBrand}
                    onChange={(e) => setAddClientId(e.target.value)}
                  >
                    {availableBrands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Role" htmlFor="add-brand-role" className="w-40">
                  <Select
                    id="add-brand-role"
                    value={addBrandRole}
                    onChange={(e) => setAddBrandRole(e.target.value)}
                  >
                    <option value="brand_admin">Brand Admin</option>
                    <option value="recruiter">Recruiter</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                </Field>
                <Button
                  onClick={() => addMembership(selectedAddBrand, addBrandRole)}
                  loading={membershipBusy}
                  disabled={!selectedAddBrand}
                >
                  Add
                </Button>
              </div>
            )}

            {canManage && availableBrands.length === 0 && user.memberships.length > 0 && (
              <p className="mt-4 border-t border-rule pt-4 text-xs text-ink-muted">
                This member is on every brand in the organisation.
              </p>
            )}

            {membershipError && (
              <Callout tone="error" className="mt-3">
                {membershipError}
              </Callout>
            )}
          </>
        )}
      </Card>

      {/* Danger zone — de-emphasised; the real guard is the confirm dialog. */}
      {user.is_active && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setConfirmDeactivate(true)}
            className="text-xs text-red transition-colors hover:underline cursor-pointer"
          >
            Deactivate user
          </button>
        </div>
      )}

      {/* Edit modal */}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit user"
        size="lg"
        dismissible={!saving}
      >
        {saveError && (
          <Callout tone="error" className="mb-4">
            {saveError}
          </Callout>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="First name" htmlFor="firstName" required>
              <Input id="firstName" name="firstName" type="text" defaultValue={user.first_name} required />
            </Field>
            <Field label="Last name" htmlFor="lastName" required>
              <Input id="lastName" name="lastName" type="text" defaultValue={user.last_name} required />
            </Field>
          </div>

          <Field label="Email" htmlFor="email" required>
            <Input id="email" name="email" type="email" defaultValue={user.email} required />
          </Field>

          <Field
            label="Org role"
            htmlFor="orgRole"
            helper="Owner and Org Admin span every brand. Member access is limited to the brands assigned under Brand access."
          >
            <Select id="orgRole" name="orgRole" defaultValue={user.org_role ?? ""}>
              {(canGrantOwner || user.org_role === "owner") && (
                <option value="owner">Owner</option>
              )}
              <option value="org_admin">Org Admin</option>
              <option value="">Member (brand-scoped)</option>
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={user.is_active}
              className="h-4 w-4 rounded border-rule accent-cobalt cursor-pointer"
            />
            Active
          </label>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reset password modal */}
      <Modal
        open={resettingPwd}
        onClose={() => setResettingPwd(false)}
        title="Reset password"
        size="md"
        dismissible={!pwdSaving}
      >
        {pwdError && (
          <Callout tone="error" className="mb-4">
            {pwdError}
          </Callout>
        )}

        <form onSubmit={handlePasswordReset} className="space-y-4">
          <Field label="New password" htmlFor="password" required>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </Field>
          <Field label="Confirm" htmlFor="confirmPassword" required>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              placeholder="Repeat password"
            />
          </Field>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setResettingPwd(false)} disabled={pwdSaving}>
              Cancel
            </Button>
            <Button type="submit" loading={pwdSaving}>
              Update password
            </Button>
          </div>
        </form>
      </Modal>

      {/* Deactivate confirmation — sign-in is revoked, so confirm first. */}
      <ConfirmModal
        open={confirmDeactivate}
        title="Deactivate this user?"
        description="They will immediately lose the ability to sign in. You can reactivate them later by editing the user and setting them back to Active."
        confirmLabel="Deactivate"
        variant="danger"
        loading={deactivating}
        onConfirm={runDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </div>
  );
}
