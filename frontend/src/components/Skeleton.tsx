import { clsx } from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700',
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
        <div key={r} className="flex gap-4">
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
        <div key={i} className="glass-card rounded-2xl p-4 sm:p-6 space-y-3">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="animate-fade-in space-y-6">
      <Skeleton className="h-8 w-48" />
      <SkeletonStatCards />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
