function Sk({ className }: { className: string }) {
  return <div className={`rounded-lg bg-[#F0F0EC] animate-[pulse-subtle_1.5s_ease-in-out_infinite] ${className}`} />;
}

export default function CampaignsLoading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Sk className="h-5 w-28 mb-2" />
          <Sk className="h-3 w-16" />
        </div>
        <Sk className="h-9 w-36 rounded-lg" />
      </div>
      <Sk className="h-9 w-64 mb-5 rounded-lg" />
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <Sk className="h-4 w-48 mb-2" />
                <Sk className="h-3 w-64" />
              </div>
              <Sk className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
