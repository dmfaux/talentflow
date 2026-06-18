"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

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
  is_active: boolean;
  created_at: string;
  updated_at: string;
  memberships: MemberBrand[];
}

const BRAND_ROLE_LABEL: Record<string, string> = {
  brand_admin: "Brand Admin",
  recruiter: "Recruiter",
  viewer: "Viewer",
};

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-gold focus:ring-1 focus:ring-gold/20";
const labelClass =
  "mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [resettingPwd, setResettingPwd] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/users/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((res) => setUser(res.data))
      .catch(() => setLoadError("User not found"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError("");
    setSaving(true);

    const form = new FormData(e.currentTarget);
    const firstName = (form.get("firstName") as string).trim();
    const lastName = (form.get("lastName") as string).trim();
    const email = (form.get("email") as string).trim();
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
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          isActive,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || "Failed to save");
        return;
      }

      const { data } = await res.json();
      setUser((prev) => (prev ? { ...prev, ...data } : prev));
      setEditing(false);
    } catch {
      setSaveError("Something went wrong");
    } finally {
      setSaving(false);
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
    } catch {
      setPwdError("Something went wrong");
    } finally {
      setPwdSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!confirm("Deactivate this user? They will no longer be able to sign in.")) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Failed to deactivate user");
        return;
      }
      router.push("/users");
    } catch {
      alert("Something went wrong");
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-sm text-txt-muted">Loading...</div>;
  }

  if (loadError || !user) {
    return (
      <div className="py-20 text-center text-sm text-red">
        {loadError || "User not found"}
      </div>
    );
  }

  const brandsLabel = user.memberships.length
    ? user.memberships
        .map((m) => `${m.client_name} (${BRAND_ROLE_LABEL[m.brand_role] ?? m.brand_role})`)
        .join(", ")
    : "—";

  const infoItems = [
    { label: "Email", value: user.email, mono: true },
    { label: "Brands", value: brandsLabel },
    { label: "Status", value: user.is_active ? "Active" : "Inactive" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/users" className="hover:text-charcoal transition-colors">
          Users
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">
          {user.first_name} {user.last_name}
        </span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-charcoal">
            {user.first_name} {user.last_name}
          </h1>
          <p className="mt-1 font-mono text-xs text-txt-muted">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setResettingPwd(true)}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-[0.8rem] font-medium text-charcoal transition-colors hover:bg-cream cursor-pointer"
          >
            Reset password
          </button>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light cursor-pointer"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Info cards */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
          {infoItems.map((item) => (
            <div key={item.label}>
              <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                {item.label}
              </dt>
              <dd
                className={`mt-1 text-sm text-charcoal ${item.mono ? "font-mono text-xs" : ""}`}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Danger zone */}
      {user.is_active && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleDeactivate}
            className="text-xs text-red hover:underline cursor-pointer"
          >
            Deactivate user
          </button>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h2 className="mb-5 text-base font-semibold text-charcoal">Edit user</h2>

            {saveError && (
              <div className="mb-4 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
                {saveError}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className={labelClass}>
                    First Name
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    defaultValue={user.first_name}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className={labelClass}>
                    Last Name
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    defaultValue={user.last_name}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className={labelClass}>
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={user.email}
                  className={inputClass}
                  required
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-charcoal">
                <input
                  name="isActive"
                  type="checkbox"
                  defaultChecked={user.is_active}
                  className="h-4 w-4 rounded border-border"
                />
                Active
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resettingPwd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h2 className="mb-5 text-base font-semibold text-charcoal">Reset password</h2>

            {pwdError && (
              <div className="mb-4 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
                {pwdError}
              </div>
            )}

            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label htmlFor="password" className={labelClass}>
                  New password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  className={inputClass}
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className={labelClass}>
                  Confirm
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  className={inputClass}
                  placeholder="Repeat password"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setResettingPwd(false)}
                  className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pwdSaving}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {pwdSaving ? "Updating..." : "Update password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
