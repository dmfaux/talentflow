function Sk({ className }: { className?: string }) {
  return <div className={`rounded-lg bg-border/40 animate-[pulse-subtle_1.5s_ease-in-out_infinite] ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <Sk className="mb-6 h-3 w-48" />
      <Sk className="mb-1 h-5 w-64" />
      <Sk className="mb-8 h-3.5 w-96" />

      <div className="space-y-6">
        <div>
          <Sk className="mb-1.5 h-3 w-12" />
          <Sk className="h-10 w-full" />
        </div>
        <div>
          <Sk className="mb-1.5 h-3 w-28" />
          <Sk className="h-40 w-full rounded-xl" />
        </div>
        <Sk className="h-10 w-full" />
      </div>
    </div>
  );
}
