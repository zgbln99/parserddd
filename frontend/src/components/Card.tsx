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
    <div className={clsx('border-b border-black/[0.06] dark:border-[#424245] px-6 py-4', className)}>
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
    primary: 'bg-[#0071e3] text-white',
    green: 'bg-[#30d158] text-white',
    orange: 'bg-[#ff9f0a] text-white',
    red: 'bg-[#ff3b30] text-white',
    blue: 'bg-[#0071e3] text-white',
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        {icon && (
          <div className={clsx(
            'flex h-11 w-11 items-center justify-center rounded-[10px]',
            iconStyles[effectiveColor],
          )}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold uppercase tracking-wide text-muted" style={{ letterSpacing: '-0.12px' }}>
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink" style={{ letterSpacing: '-0.28px' }}>
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
