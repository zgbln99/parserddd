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
    <div className={clsx('border-b border-[#e6ebf1] px-4 py-4 font-medium text-[#111928] dark:border-[#374151] dark:text-white sm:px-6', className)}>
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('p-4 sm:p-6', className)}>{children}</div>;
}

const ICON_GRAD: Record<string, string> = {
  primary: 'from-[#6e68f3] to-[#4a44d4]',
  green: 'from-[#34d399] to-[#16a34a]',
  orange: 'from-[#fbbf24] to-[#f59e0b]',
  red: 'from-[#fb7185] to-[#ef4444]',
  blue: 'from-[#60a5fa] to-[#3b82f6]',
};

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
  const c = color !== 'primary' ? color : (variant || 'primary');

  return (
    <div className="card relative overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div
        className={clsx(
          'pointer-events-none absolute -right-7 -top-7 h-24 w-24 rounded-full bg-gradient-to-br opacity-[0.08] blur-2xl',
          ICON_GRAD[c],
        )}
      />
      <div className="relative flex items-center gap-4">
        {icon && (
          <div
            className={clsx(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm',
              ICON_GRAD[c],
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#6b7280] dark:text-[#9ca3af]">{label}</p>
          <p className="mt-1 text-[28px] font-extrabold leading-none tracking-tight text-[#111928] tabular-nums dark:text-white">
            {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
          </p>
        </div>
      </div>
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const display = useCountUp(value);
  return <>{display.toLocaleString()}</>;
}
