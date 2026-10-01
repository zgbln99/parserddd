import { clsx } from 'clsx';
import { useCountUp } from '../hooks/useCountUp';

export function Card({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('border-b border-border px-4 py-3.5 font-semibold text-ink sm:px-5', className)}>
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('p-4 sm:p-5', className)}>{children}</div>;
}

type Tone = 'primary' | 'green' | 'orange' | 'red' | 'blue';

const STRIPE: Record<Tone, string> = {
  primary: 'kpi-accent',
  blue: 'kpi-accent',
  green: 'kpi-ok',
  orange: 'kpi-warn',
  red: 'kpi-crit',
};

const ICON_TONE: Record<Tone, string> = {
  primary: 'bg-accent-light text-accent',
  blue: 'bg-accent-light text-accent',
  green: 'bg-success-soft text-success',
  orange: 'bg-warning-soft text-warning',
  red: 'bg-danger-soft text-danger',
};

/** KPI tile: the stripe on the left carries the state, the number carries the value. */
export function StatCard({
  label,
  value,
  icon,
  color = 'primary',
  variant,
  detail,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: Tone;
  variant?: Exclude<Tone, 'primary'>;
  detail?: string;
}) {
  const c: Tone = color !== 'primary' ? color : (variant || 'primary');

  return (
    <div className={clsx('card kpi p-4', STRIPE[c])} data-animate>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-muted">{label}</p>
          <p className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-ink tabular-nums">
            {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
          </p>
          {detail && <p className="mt-1.5 truncate text-xs text-muted">{detail}</p>}
        </div>
        {icon && (
          <div className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ICON_TONE[c])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const display = useCountUp(value);
  return <>{display.toLocaleString()}</>;
}
