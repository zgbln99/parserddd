import { clsx } from 'clsx';

type Variant = 'green' | 'orange' | 'yellow' | 'red' | 'blue' | 'gray';

const variantClasses: Record<Variant, string> = {
  green: 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  orange: 'bg-amber-100/80 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  yellow: 'bg-yellow-100/80 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400',
  red: 'bg-rose-100/80 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  blue: 'bg-blue-100/80 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  gray: 'bg-gray-100/80 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400',
};

const dotClasses: Record<Variant, string> = {
  green: 'bg-emerald-500 shadow-emerald-500/50',
  orange: 'bg-amber-500 shadow-amber-500/50',
  yellow: 'bg-yellow-500 shadow-yellow-500/50',
  red: 'bg-rose-500 shadow-rose-500/50',
  blue: 'bg-blue-500 shadow-blue-500/50',
  gray: 'bg-gray-400 shadow-gray-400/50',
};

export function Badge({ variant = 'gray', children, dot }: { variant?: Variant; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold backdrop-blur-sm',
      variantClasses[variant],
    )}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full shadow-sm', dotClasses[variant])} />}
      {children}
    </span>
  );
}

export function StatusDot({ color }: { color: 'green' | 'orange' | 'red' }) {
  return <span className={clsx('inline-block h-2 w-2 rounded-full shadow-sm', dotClasses[color])} />;
}
