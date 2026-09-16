function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-2xl bg-slate-200/75 dark:bg-white/[0.06] motion-reduce:animate-none ${className}`}
    />
  );
}

export default function AppHomeLoading() {
  return (
    <div
      className="container mx-auto px-4 py-6 md:px-6"
      role="status"
      aria-label="Workfare wird geladen"
      aria-busy="true"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-3">
          <SkeletonBlock className="h-9 w-48" />
          <SkeletonBlock className="h-5 w-80 max-w-full" />
        </div>

        <div className="flex items-center gap-3 border-b border-slate-200/80 pb-4 dark:border-white/10">
          <SkeletonBlock className="h-10 w-28 rounded-xl" />
          <SkeletonBlock className="h-10 w-32 rounded-xl" />
          <SkeletonBlock className="h-10 w-28 rounded-xl" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SkeletonBlock className="h-[280px]" />
          <SkeletonBlock className="h-[280px]" />
          <SkeletonBlock className="h-[280px]" />
          <SkeletonBlock className="h-[280px]" />
        </div>
      </div>
    </div>
  );
}
