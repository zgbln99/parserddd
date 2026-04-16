import { clsx } from 'clsx';

type Variant = 'green' | 'orange' | 'yellow' | 'red' | 'blue' | 'gray';

const variantClasses: Record<Variant, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
  orange: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800',
  red: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800',
  blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
  gray: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700',
};

const dotClasses: Record<Variant, string> = {
  green: 'bg-emerald-500',
  orange: 'bg-amber-500',
  yellow: 'bg-yellow-500',
  red: 'bg-rose-500',
  blue: 'bg-blue-500',
  gray: 'bg-gray-400',
};

export function Badge({ variant = 'gray', children, dot }: { variant?: Variant; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-xs font-medium',
      variantClasses[variant],
    )}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', dotClasses[variant])} />}
      {children}
    </span>
  );
}

export function StatusDot({ color }: { color: 'green' | 'orange' | 'red' }) {
  return <span className={clsx('inline-block h-2 w-2 rounded-full', dotClasses[color])} />;
}
