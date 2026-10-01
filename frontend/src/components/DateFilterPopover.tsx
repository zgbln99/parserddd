import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { MonthSelect } from './MonthSelect';
import { monthRange, dateRangeToMonth, monthLabel } from '../lib/utils';
import { popIn } from '../lib/motion';

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The global period filter as one compact button. Clicking it opens a panel
 * with the month picker, quick presets and an explicit from/to range, so the
 * top bar never wraps — on a phone the same panel drops down full width.
 */
export function DateFilterPopover() {
  const { t, locale } = useI18n();
  const { dateFrom, dateTo, setDateFrom, setDateTo, clear } = useDateFilter();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const presets = [
    { label: t('filterThisMonth'), fn: () => { const n = new Date(); setDateFrom(fmt(new Date(n.getFullYear(), n.getMonth(), 1))); setDateTo(fmt(new Date(n.getFullYear(), n.getMonth() + 1, 0))); } },
    { label: t('filterLastMonth'), fn: () => { const n = new Date(); setDateFrom(fmt(new Date(n.getFullYear(), n.getMonth() - 1, 1))); setDateTo(fmt(new Date(n.getFullYear(), n.getMonth(), 0))); } },
    { label: t('filterLast30'), fn: () => { const n = new Date(); setDateFrom(fmt(new Date(n.getTime() - 30 * 86400000))); setDateTo(fmt(n)); } },
  ];

  const monthVal = dateRangeToMonth(dateFrom, dateTo);
  const fmtDM = (s: string) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '…');
  const label = monthVal
    ? monthLabel(monthVal, locale)
    : (dateFrom || dateTo) ? `${fmtDM(dateFrom)} – ${fmtDM(dateTo)}` : t('filterCustomRange');
  const active = Boolean(dateFrom || dateTo);

  useEffect(() => {
    if (!open) return;
    popIn(panel.current);
    const onClick = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrap} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'flex h-9 max-w-full items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition',
          active ? 'border-accent/40 bg-accent-light text-accent' : 'border-border bg-card text-ink hover:border-accent hover:text-accent',
        )}
        title={t('filterMonth')}
      >
        <Calendar size={15} className="shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className={clsx('shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={panel}
          role="dialog"
          className="card absolute left-0 top-11 z-40 w-[min(92vw,340px)] p-3 shadow-[var(--shadow-3)]"
        >
          <MonthSelect
            value={monthVal}
            onChange={(v) => { if (v) { const r = monthRange(v); setDateFrom(r.from); setDateTo(r.to); setOpen(false); } }}
            allowEmpty
            emptyLabel={t('filterCustomRange')}
            title={t('filterMonth')}
            className="input mb-2 w-full rounded-lg px-3 py-2 text-sm"
          />
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            {presets.map(({ label: l, fn }) => (
              <button
                key={l}
                type="button"
                onClick={() => { fn(); setOpen(false); }}
                className="btn-secondary rounded-lg px-2 py-2 text-xs"
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs dark:[color-scheme:dark]"
            />
            <span className="shrink-0 text-xs text-muted">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs dark:[color-scheme:dark]"
            />
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            {active ? (
              <button
                type="button"
                onClick={() => { clear(); setOpen(false); }}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger-soft"
              >
                <X size={13} /> {t('clear')}
              </button>
            ) : <span />}
            <button type="button" onClick={() => setOpen(false)} className="btn-primary btn-press px-4 py-1.5 text-xs">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
