import { clsx } from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'rounded-lg skeleton-shimmer',
        className,
      )}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 space-y-4">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4" style={{ animationDelay: `${r * 75}ms` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="glass-card rounded-2xl p-4 sm:p-6 space-y-3 animate-fade-in"
          style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'backwards' }}
        >
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 !rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <SkeletonStatCards />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-card rounded-2xl animate-fade-in" style={{ animationDelay: '300ms', animationFillMode: 'backwards' }}>
          <div className="border-b border-white/20 px-5 py-4 dark:border-white/5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 !rounded-lg" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-5 w-10" />
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card rounded-2xl animate-fade-in" style={{ animationDelay: '400ms', animationFillMode: 'backwards' }}>
          <div className="border-b border-white/20 px-5 py-4 dark:border-white/5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 !rounded-lg" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
          <div className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-5 w-10" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
