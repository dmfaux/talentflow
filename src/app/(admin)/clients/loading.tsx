function Sk({ className }: { className: string }) {
  return <div className={`rounded-lg bg-[#F0F0EC] animate-[pulse-subtle_1.5s_ease-in-out_infinite] ${className}`} />;
}

export default function ClientsLoading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Sk className="h-5 w-20 mb-2" />
          <Sk className="h-3 w-14" />
        </div>
        <Sk className="h-9 w-32 rounded-lg" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3 flex gap-12">
          {Array.from({ length: 5 }, (_, i) => (
            <Sk key={i} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-12 px-5 py-3 border-b border-border last:border-0">
            <Sk className="h-3 w-32" />
            <Sk className="h-3 w-24" />
            <Sk className="h-3 w-36" />
            <Sk className="h-3 w-8" />
            <Sk className="h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
