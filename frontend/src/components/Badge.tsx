import { clsx } from 'clsx';

type Variant = 'green' | 'orange' | 'yellow' | 'red' | 'blue' | 'gray';

const variantClasses: Record<Variant, string> = {
  green: 'bg-[#30d158]/10 text-[#248a3d] dark:bg-[#30d158]/15 dark:text-[#30d158]',
  orange: 'bg-[#ff9f0a]/10 text-[#c93400] dark:bg-[#ff9f0a]/15 dark:text-[#ff9f0a]',
  yellow: 'bg-[#ffd60a]/10 text-[#9e6c00] dark:bg-[#ffd60a]/15 dark:text-[#ffd60a]',
  red: 'bg-[#ff3b30]/10 text-[#d70015] dark:bg-[#ff453a]/15 dark:text-[#ff453a]',
  blue: 'bg-[#0071e3]/10 text-[#0066cc] dark:bg-[#2997ff]/15 dark:text-[#2997ff]',
  gray: 'bg-black/[0.04] text-[rgba(0,0,0,0.56)] dark:bg-white/[0.06] dark:text-[rgba(255,255,255,0.56)]',
};

const dotClasses: Record<Variant, string> = {
  green: 'bg-[#30d158]',
  orange: 'bg-[#ff9f0a]',
  yellow: 'bg-[#ffd60a]',
  red: 'bg-[#ff3b30]',
  blue: 'bg-[#0071e3]',
  gray: 'bg-[rgba(0,0,0,0.24)]',
};

export function Badge({ variant = 'gray', children, dot }: { variant?: Variant; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-[12px] font-semibold',
      variantClasses[variant],
    )} style={{ letterSpacing: '-0.12px' }}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', dotClasses[variant])} />}
      {children}
    </span>
  );
}

export function StatusDot({ color }: { color: 'green' | 'orange' | 'red' }) {
  return <span className={clsx('inline-block h-2 w-2 rounded-full', dotClasses[color])} />;
}
