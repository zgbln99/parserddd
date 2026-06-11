import type { ReactNode } from 'react';

/**
 * Consistent, premium "nothing here" panel — replaces bare one-line
 * "no data" texts. Optional icon, title, hint and an action.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}>
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-muted">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
