function Sk({ className }: { className: string }) {
  return <div className={`rounded-lg bg-canvas-2 animate-[pulse-subtle_1.5s_ease-in-out_infinite] ${className}`} />;
}

export default function CampaignDetailLoading() {
  return (
    <div>
      <Sk className="h-3 w-32 mb-6" />
      <div className="mb-8">
        <Sk className="h-7 w-64 mb-2" />
        <Sk className="h-3 w-80" />
      </div>
      {/* Stats row */}
      <div className="mb-6 grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-xl border border-rule bg-surface px-5 py-4">
            <Sk className="h-3 w-16 mb-3" />
            <Sk className="h-7 w-12" />
          </div>
        ))}
      </div>
      {/* Pipeline */}
      <div className="mb-6 rounded-xl border border-rule bg-surface px-6 py-5">
        <Sk className="h-3 w-16 mb-5" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 mb-3">
            <Sk className="h-3 w-28" />
            <Sk className="h-8 flex-1 rounded-lg" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="rounded-xl border border-rule bg-surface">
        <div className="border-b border-rule px-5 py-3">
          <Sk className="h-4 w-28" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-rule last:border-0">
            <Sk className="h-8 w-8 rounded-full" />
            <Sk className="h-3 w-32 flex-1" />
            <Sk className="h-3 w-10" />
            <Sk className="h-5 w-14 rounded-full" />
            <Sk className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
