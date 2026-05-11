import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { monthLabel } from '../lib/utils';

interface MonthSelectProps {
  /** Selected month as 'YYYY-MM', or '' when allowEmpty is on. */
  value: string;
  onChange: (value: string) => void;
  /** How many months back from the current month to list (default 24). */
  monthsBack?: number;
  /** How many months ahead of the current month to list (default 0). */
  monthsForward?: number;
  /** Show a leading "no specific month" option. */
  allowEmpty?: boolean;
  /** Label for the empty option (default: localized "custom range"). */
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * Month picker rendered as a plain <select> with named months
 * ("März 2026", "Lipiec 2026", …) — friendlier than a native
 * <input type="month"> for users who think in calendar months.
 */
export function MonthSelect({
  value,
  onChange,
  monthsBack = 24,
  monthsForward = 0,
  allowEmpty = false,
  emptyLabel,
  className,
  disabled,
  title,
}: MonthSelectProps) {
  const { t, locale } = useI18n();

  const options = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = monthsForward; i >= -monthsBack; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({ value: v, label: monthLabel(v, locale) });
    }
    // Keep the current value selectable even if it falls outside the window.
    if (value && !out.some((o) => o.value === value)) {
      out.unshift({ value, label: monthLabel(value, locale) });
    }
    return out;
  }, [locale, monthsBack, monthsForward, value]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title={title}
      className={className ?? 'input rounded-lg px-3 py-2 text-sm'}
    >
      {allowEmpty && <option value="">{emptyLabel ?? t('filterCustomRange')}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
