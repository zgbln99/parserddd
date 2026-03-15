import { clsx } from 'clsx';

export function Card({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('glass-card rounded-2xl', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('border-b border-white/20 px-6 py-4 dark:border-white/5', className)}>
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
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: 'primary' | 'green' | 'orange' | 'red';
}) {
  const iconBg: Record<string, string> = {
    primary: 'from-blue-500 to-blue-600 shadow-blue-200 dark:shadow-blue-900/30',
    green: 'from-emerald-500 to-emerald-600 shadow-emerald-200 dark:shadow-emerald-900/30',
    orange: 'from-amber-500 to-amber-600 shadow-amber-200 dark:shadow-amber-900/30',
    red: 'from-rose-500 to-rose-600 shadow-rose-200 dark:shadow-rose-900/30',
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        {icon && (
          <div className={clsx(
            'flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg',
            iconBg[color],
          )}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
        </div>
      </div>
    </Card>
  );
}
