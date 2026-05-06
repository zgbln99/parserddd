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

const ICON_BG: Record<string, string> = {
  primary: 'bg-[rgba(87,80,241,0.08)] text-[#5750f1]',
  green: 'bg-[rgba(34,173,92,0.08)] text-[#22ad5c]',
  orange: 'bg-[rgba(245,158,11,0.08)] text-[#f59e0b]',
  red: 'bg-[rgba(242,48,48,0.08)] text-[#f23030]',
  blue: 'bg-[rgba(60,80,224,0.08)] text-[#3c50e0]',
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
    <div className="card p-5">
      <div className="flex items-center gap-4">
        {icon && (
          <div className={clsx('flex h-12 w-12 items-center justify-center rounded-full', ICON_BG[c])}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#6b7280] dark:text-[#9ca3af]">{label}</p>
          <p className="mt-0.5 text-2xl font-bold text-[#111928] dark:text-white">
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
