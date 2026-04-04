"use client";

import { useEffect, useState } from "react";

export function ActiveCampaignCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/campaigns?status=active")
      .then((r) => r.json())
      .then((res) => setCount(res.data?.length ?? 0))
      .catch(() => setCount(0));
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-txt-secondary">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green" />
      <span className="font-mono">
        {count === null ? "..." : `${count} active campaign${count !== 1 ? "s" : ""}`}
      </span>
    </div>
  );
}
