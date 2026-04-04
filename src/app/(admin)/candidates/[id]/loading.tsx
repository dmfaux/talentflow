function Sk({ className }: { className: string }) {
  return <div className={`rounded-lg bg-[#F0F0EC] animate-[pulse-subtle_1.5s_ease-in-out_infinite] ${className}`} />;
}

export default function CandidateDetailLoading() {
  return (
    <div>
      <Sk className="h-3 w-48 mb-6" />
      <div className="mb-8">
        <Sk className="h-7 w-56 mb-2" />
        <Sk className="h-3 w-80" />
      </div>
      <div className="flex gap-6 items-start">
        {/* Left column */}
        <div className="w-80 shrink-0 space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <Sk className="h-3 w-20 mb-3" />
            <Sk className="h-10 w-16 mb-5" />
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="mb-3">
                <div className="flex justify-between mb-1">
                  <Sk className="h-3 w-24" />
                  <Sk className="h-3 w-8" />
                </div>
                <Sk className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex justify-between mb-2 last:mb-0">
                <Sk className="h-3 w-20" />
                <Sk className="h-3 w-24" />
              </div>
            ))}
          </div>
        </div>
        {/* Right column */}
        <div className="flex-1 space-y-6">
          <div className="rounded-xl border border-border bg-surface p-5">
            <Sk className="h-3 w-24 mb-3" />
            <Sk className="h-4 w-full mb-2" />
            <Sk className="h-4 w-3/4" />
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <Sk className="h-4 w-36 mb-4" />
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rounded-lg border border-border p-3 mb-2">
                <Sk className="h-3 w-48 mb-1" />
                <Sk className="h-3 w-32" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <Sk className="h-4 w-28 mb-4" />
            <Sk className="h-16 w-full rounded-lg mb-3" />
            <Sk className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
