export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
      <div className="w-8 h-8 rounded-lg bg-slate-800 animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-24 rounded bg-slate-800 animate-pulse" />
        <div className="h-2 w-16 rounded bg-slate-800/70 animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-slate-800 animate-pulse ml-auto" />
        <div className="h-2 w-12 rounded bg-slate-800/70 animate-pulse ml-auto" />
      </div>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-slate-800 animate-pulse" />
          <div className="h-3 w-20 rounded bg-slate-800/70 animate-pulse" />
        </div>
        <div className="h-8 w-8 rounded-lg bg-slate-800 animate-pulse" />
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="space-y-1.5">
            <div className="h-2 w-12 rounded bg-slate-800/70 animate-pulse" />
            <div className="h-3 w-16 rounded bg-slate-800 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-8 flex-1 rounded-lg bg-slate-800/70 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="h-2.5 w-20 rounded bg-slate-800 animate-pulse" />
        <div className="h-4 w-4 rounded bg-slate-800 animate-pulse" />
      </div>
      <div className="h-6 w-28 rounded bg-slate-800 animate-pulse" />
      <div className="h-2 w-16 rounded bg-slate-800/70 animate-pulse mt-2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <div className="h-4 w-40 rounded bg-slate-800 animate-pulse" />
      </div>
      <div className="divide-y divide-white/[0.03]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-3 px-5">
            <div className="h-3 w-24 rounded bg-slate-800 animate-pulse" />
            <div className="h-3 w-12 rounded bg-slate-800 animate-pulse" />
            <div className="h-5 w-14 rounded bg-slate-800/70 animate-pulse" />
            <div className="flex-1" />
            <div className="h-3 w-20 rounded bg-slate-800 animate-pulse" />
            <div className="h-3 w-16 rounded bg-slate-800/70 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
