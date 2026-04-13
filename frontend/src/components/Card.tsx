import { clsx } from 'clsx';
import { useCountUp } from '../hooks/useCountUp';

export function Card({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('card', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('border-b border-border px-6 py-4', className)}>
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('px-6 py-4', className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  icon,
  color = 'primary',
  variant,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: 'primary' | 'green' | 'orange' | 'red' | 'blue';
  variant?: 'green' | 'orange' | 'red' | 'blue';
}) {
  const effectiveColor = color !== 'primary' ? color : (variant || 'primary');
  const iconStyles: Record<string, string> = {
    primary: 'bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-500/20',
    green: 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/20',
    orange: 'bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-lg shadow-amber-500/20',
    red: 'bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-lg shadow-rose-500/20',
    blue: 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-500/20',
  };

  const topGradient: Record<string, string> = {
    primary: 'from-primary-500/5 to-transparent',
    green: 'from-emerald-500/5 to-transparent',
    orange: 'from-amber-500/5 to-transparent',
    red: 'from-rose-500/5 to-transparent',
    blue: 'from-blue-500/5 to-transparent',
  };

  return (
    <Card className="relative overflow-hidden p-5">
      {/* Top gradient glow */}
      <div className={clsx('absolute inset-x-0 top-0 h-16 bg-gradient-to-b', topGradient[effectiveColor])} />
      <div className="relative flex items-center gap-4">
        {icon && (
          <div className={clsx(
            'flex h-12 w-12 items-center justify-center rounded-2xl',
            iconStyles[effectiveColor],
          )}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">
            {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
          </p>
        </div>
      </div>
    </Card>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const display = useCountUp(value);
  return <>{display.toLocaleString()}</>;
}
