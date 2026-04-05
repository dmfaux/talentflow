"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

interface ClientOption {
  id: string;
  name: string;
}

export default function NewTemplatePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [clientsList, setClientsList] = useState<ClientOption[]>([]);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerClientId, setOwnerClientId] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((res) => {
        const data = res.data ?? [];
        setClientsList(
          data.map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          }))
        );
      })
      .catch(() => {
        // Leave list empty; user can still select Shared Library.
      });
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");

    if (!key.trim()) {
      setFormError("Template key is required");
      return;
    }
    if (!name.trim()) {
      setFormError("Display name is required");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || null,
          thumbnail_url: thumbnailUrl.trim() || null,
          owner_client_id: ownerClientId || null,
          is_active: isActive,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error || "Failed to register template");
        return;
      }

      router.push("/templates");
    } catch {
      setFormError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20";
  const textareaClass =
    "w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-cobalt focus:ring-1 focus:ring-cobalt/20 resize-none";
  const labelClass =
    "mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted";

  return (
    <div className="mx-auto max-w-3xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/templates" className="hover:text-charcoal transition-colors">
          Templates
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">Register</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-xl border border-border bg-surface p-8">
          <h1 className="font-display mb-6 text-xl font-medium text-charcoal">
            Register Template
          </h1>

          {formError && (
            <div className="mb-5 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
              {formError}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label htmlFor="key" className={labelClass}>
                Template Key <span className="text-red">*</span>
              </label>
              <input
                id="key"
                type="text"
                required
                autoFocus
                value={key}
                placeholder="editorial"
                onChange={(e) => setKey(e.target.value)}
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1.5 text-[0.7rem] text-txt-muted">
                Must match the component key in src/templates/registry.ts
                (e.g. &apos;editorial&apos;, &apos;corporate&apos;, &apos;modern&apos;).
                The template component must already exist in the codebase and be
                registered in the registry before you can register it here.
              </p>
            </div>

            <div>
              <label htmlFor="name" className={labelClass}>
                Display Name <span className="text-red">*</span>
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                placeholder="Editorial"
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="description" className={labelClass}>
                Description
              </label>
              <textarea
                id="description"
                rows={3}
                value={description}
                placeholder="A clean, magazine-style template with serif typography..."
                onChange={(e) => setDescription(e.target.value)}
                className={textareaClass}
              />
            </div>

            <div>
              <label htmlFor="owner_client_id" className={labelClass}>
                Owner Client <span className="text-red">*</span>
              </label>
              <select
                id="owner_client_id"
                value={ownerClientId}
                onChange={(e) => setOwnerClientId(e.target.value)}
                className={inputClass}
              >
                <option value="">Shared Library (null)</option>
                {clientsList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="thumbnail_url" className={labelClass}>
                Thumbnail URL
              </label>
              <input
                id="thumbnail_url"
                type="text"
                value={thumbnailUrl}
                placeholder="/templates/editorial.svg"
                onChange={(e) => setThumbnailUrl(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1.5 text-[0.7rem] text-txt-muted">
                Path like /templates/my-template.svg or a full URL
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="is_active"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-border text-cobalt focus:ring-cobalt/20 cursor-pointer"
              />
              <label
                htmlFor="is_active"
                className="text-sm text-charcoal cursor-pointer"
              >
                Active (visible in campaign gallery)
              </label>
            </div>
          </div>
        </div>

        {/* Warning about registry sync */}
        <div className="rounded-lg border border-saffron/30 bg-saffron/5 p-4 text-sm text-ink">
          <p className="font-medium">
            The template component must already exist in the codebase
            (src/templates/) and be registered in src/templates/registry.ts
            before you can register it here.
          </p>
          <p className="mt-1 text-ink-muted">
            If the key doesn&apos;t match a registered component, the save will fail.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Link
            href="/templates"
            className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-cobalt px-5 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading && (
              <svg
                className="h-3.5 w-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            Save Template
          </button>
        </div>
      </form>
    </div>
  );
}
