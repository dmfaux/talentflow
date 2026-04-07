"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  security_group: string;
  client_id: string;
  client_name: string | null;
  is_active: boolean;
  created_at: string;
}

const GROUP_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  user: "User",
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((res) => setUsers(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-charcoal">Users</h1>
          <p className="mt-0.5 text-xs text-txt-muted">
            {loading ? "Loading..." : `${users.length} total`}
          </p>
        </div>
        <Link
          href="/users/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          New User
        </Link>
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
                Email
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Role
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Client
              </th>
              <th className="px-5 py-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-txt-muted">
                  Loading users...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-txt-muted">
                  No users yet.{" "}
                  <Link href="/users/new" className="text-accent hover:underline">
                    Create one
                  </Link>
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="group cursor-pointer transition-colors hover:bg-cream/60"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    router.push(`/users/${user.id}`);
                  }}
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/users/${user.id}`}
                      className="block text-sm font-medium text-charcoal group-hover:text-accent"
                    >
                      {user.first_name} {user.last_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-txt-secondary">
                    {user.email}
                  </td>
                  <td className="px-5 py-3 text-sm text-txt-secondary">
                    {GROUP_LABELS[user.security_group] ?? user.security_group}
                  </td>
                  <td className="px-5 py-3 text-sm text-txt-secondary">
                    {user.client_name || <span className="text-txt-muted">&mdash;</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          user.is_active ? "bg-green" : "bg-red"
                        }`}
                      />
                      <span className="text-txt-secondary">
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
