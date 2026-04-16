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
    primary: 'bg-primary-500 text-white',
    green: 'bg-emerald-500 text-white',
    orange: 'bg-amber-500 text-white',
    red: 'bg-rose-500 text-white',
    blue: 'bg-primary-500 text-white',
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        {icon && (
          <div className={clsx(
            'flex h-12 w-12 items-center justify-center rounded',
            iconStyles[effectiveColor],
          )}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted">
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
