import { clsx } from 'clsx';

type Variant = 'green' | 'orange' | 'yellow' | 'red' | 'blue' | 'gray';

const variantClasses: Record<Variant, string> = {
  green: 'bg-[rgba(34,173,92,0.08)] text-[#219653]',
  orange: 'bg-[rgba(255,167,11,0.08)] text-[#FFA70B]',
  yellow: 'bg-[rgba(245,158,11,0.08)] text-[#f59e0b]',
  red: 'bg-[rgba(211,64,83,0.08)] text-[#D34053]',
  blue: 'bg-[rgba(60,80,224,0.08)] text-[#3c50e0]',
  gray: 'bg-[#f3f4f6] text-[#6b7280] dark:bg-[#1f2a37] dark:text-[#9ca3af]',
};

const dotClasses: Record<Variant, string> = {
  green: 'bg-[#219653]',
  orange: 'bg-[#FFA70B]',
  yellow: 'bg-[#f59e0b]',
  red: 'bg-[#D34053]',
  blue: 'bg-[#3c50e0]',
  gray: 'bg-[#9ca3af]',
};

export function Badge({ variant = 'gray', children, dot }: { variant?: Variant; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
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
