import { clsx } from 'clsx';

type Variant = 'green' | 'orange' | 'red' | 'blue' | 'gray';

const variantClasses: Record<Variant, string> = {
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  blue: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const dotClasses: Record<Variant, string> = {
  green: 'bg-green-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  blue: 'bg-primary-500',
  gray: 'bg-gray-400',
};

export function Badge({ variant = 'gray', children, dot }: { variant?: Variant; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', variantClasses[variant])}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', dotClasses[variant])} />}
      {children}
    </span>
  );
}

export function StatusDot({ color }: { color: 'green' | 'orange' | 'red' }) {
  return <span className={clsx('inline-block h-2 w-2 rounded-full', dotClasses[color])} />;
}
