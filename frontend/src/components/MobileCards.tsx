import type { ReactNode } from 'react';

/**
 * Wrapper that shows table on desktop and card list on mobile.
 * Pass `table` for the existing table JSX and `cards` for the mobile card view.
 */
export function ResponsiveTable({ table, cards }: { table: ReactNode; cards: ReactNode }) {
  return (
    <>
      {/* Desktop: table */}
      <div className="hidden sm:block">{table}</div>
      {/* Mobile: cards */}
      <div className="block sm:hidden">{cards}</div>
    </>
  );
}

/** A single card row for mobile table replacement */
export function MobileCard({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-white/20 bg-white/50 p-4 dark:border-white/5 dark:bg-white/5 ${onClick ? 'cursor-pointer active:bg-blue-50/50 dark:active:bg-blue-900/10' : ''}`}
    >
      {children}
    </div>
  );
}

/** Label-value pair inside a MobileCard */
export function CardField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${className ?? ''}`}>
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}
