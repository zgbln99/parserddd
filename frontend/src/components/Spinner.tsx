import { clsx } from 'clsx';

export function Spinner({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'h-5 w-5 border-2' : size === 'lg' ? 'h-10 w-10 border-[3px]' : 'h-7 w-7 border-[3px]';
  return (
    <div
      className={clsx(
        s,
        'animate-spin rounded-full border-border border-t-primary-600 dark:border-t-primary-400',
        className,
      )}
    />
  );
}
