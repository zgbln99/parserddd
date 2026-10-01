import { clsx } from 'clsx';

type Variant = 'green' | 'orange' | 'yellow' | 'red' | 'blue' | 'gray';

/* State chip: soft fill + saturated text, both from theme tokens. */
const variantClasses: Record<Variant, string> = {
  green: 'bg-success-soft text-success',
  orange: 'bg-warning-soft text-warning',
  yellow: 'bg-warning-soft text-warning',
  red: 'bg-danger-soft text-danger',
  blue: 'bg-info-soft text-info',
  gray: 'bg-surface-2 text-muted',
};

const dotClasses: Record<Variant, string> = {
  green: 'bg-success',
  orange: 'bg-warning',
  yellow: 'bg-warning',
  red: 'bg-danger',
  blue: 'bg-info',
  gray: 'bg-muted',
};

export function Badge({ variant = 'gray', children, dot }: { variant?: Variant; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold',
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
