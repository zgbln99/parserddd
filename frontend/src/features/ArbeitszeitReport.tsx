import { useState, useRef, useMemo } from 'react';
import { useI18n } from '../i18n';
import type { ShiftDetail } from '../types';

interface Activity {
  start: string;
  end: string;
  duration_minutes: number;
  type: string;
}

// Samsara colors — same as ArbeitszeitberichtPage
const TYPE_COLORS: Record<string, { color: string; labelPl: string; labelDe: string }> = {
  DRIVING:      { color: '#4ade80', labelPl: 'W trakcie jazdy', labelDe: 'Lenkzeit' },
  WORK:         { color: '#f59e0b', labelPl: 'Pracujący',       labelDe: 'Arbeitszeit' },
  REST:         { color: '#3b82f6', labelPl: 'Odpoczywający',   labelDe: 'Ruhezeit' },
  AVAILABILITY: { color: '#9ca3af', labelPl: 'Dostępny',        labelDe: 'Bereitschaft' },
  UNKNOWN:      { color: '#e5e7eb', labelPl: 'Nieznany',        labelDe: 'Unbekannt' },
};

const TYPE_HEIGHT: Record<string, number> = {
  DRIVING: 100,
  WORK: 72,
  REST: 48,
  AVAILABILITY: 36,
  UNKNOWN: 36,
};

function fmtHm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

function fmtTime(s: string) {
  return s?.slice(11, 16) || '';
}

function timeToMin(s: string): number {
  const h = parseInt(s.slice(11, 13) || '0', 10);
  const m = parseInt(s.slice(14, 16) || '0', 10);
  return h * 60 + m;
}

export function ArbeitszeitReport({ shift }: { shift: ShiftDetail }) {
  const { locale } = useI18n();
  const activities: Activity[] = (shift as any).activity_timeline || [];
  const [hover, setHover] = useState<{ idx: number; x: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => {
    const s: Record<string, number> = {};
    for (const a of activities) {
      s[a.type] = (s[a.type] || 0) + a.duration_minutes;
    }
    return s;
  }, [activities]);

  if (activities.length === 0) return null;

  // Time axis calculations
  const startMin = timeToMin(shift.shift_start);
  let endMin = timeToMin(shift.shift_end);
  if (endMin <= startMin) endMin += 24 * 60;
  const totalSpan = endMin - startMin || 1;

  const firstHour = Math.ceil(startMin / 60);
  const lastHour = Math.floor(endMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  const BAR_H = 64;

  const handleMouse = (e: React.MouseEvent, idx: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    setHover({ idx, x: e.clientX - rect.left });
  };

  const totalMin = shift.duration_minutes || activities.reduce((s, a) => s + a.duration_minutes, 0);
  const types = ['DRIVING', 'WORK', 'REST', 'AVAILABILITY'] as const;

  return (
    <div className="space-y-0">
      {/* Driver name + date range */}
      <div className="px-1 pb-3">
        <p className="text-[13px] text-[rgba(0,0,0,0.48)] dark:text-[rgba(255,255,255,0.56)]">
          {shift.shift_date} &nbsp; {fmtTime(shift.shift_start)} – {fmtTime(shift.shift_end)}
          <span className="ml-3 font-semibold text-ink">{fmtHm(totalMin)}</span>
        </p>
      </div>

      {/* Time-axis timeline with varying block heights */}
      <div className="w-full">
        <div
          ref={barRef}
          className="relative w-full bg-[#f5f5f7] dark:bg-[#272729]"
          style={{ height: BAR_H }}
        >
          {/* Activity blocks — bottom-aligned */}
          {activities.map((a, i) => {
            let aStart = timeToMin(a.start);
            let aEnd = timeToMin(a.end);
            if (aStart < startMin && aEnd <= startMin) { aStart += 24 * 60; aEnd += 24 * 60; }
            if (aEnd <= aStart) aEnd += 24 * 60;
            const left = ((aStart - startMin) / totalSpan) * 100;
            const width = ((aEnd - aStart) / totalSpan) * 100;
            const cfg = TYPE_COLORS[a.type] || TYPE_COLORS.UNKNOWN;
            const hPct = TYPE_HEIGHT[a.type] ?? 36;
            const heightPx = Math.round((hPct / 100) * BAR_H);
            const isHovered = hover?.idx === i;

            return (
              <div
                key={i}
                className="absolute bottom-0 cursor-pointer transition-opacity"
                style={{
                  left: `${Math.max(0, left)}%`,
                  width: `${Math.max(0.3, Math.min(width, 100 - Math.max(0, left)))}%`,
                  height: heightPx,
                  backgroundColor: cfg.color,
                  opacity: isHovered ? 0.85 : 1,
                  zIndex: isHovered ? 20 : 1,
                }}
                onMouseEnter={(e) => handleMouse(e, i)}
                onMouseMove={(e) => handleMouse(e, i)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}

          {/* Hour grid lines */}
          {hours.map(h => {
            const pos = ((h * 60 - startMin) / totalSpan) * 100;
            if (pos <= 0 || pos >= 100) return null;
            return (
              <div
                key={h}
                className="absolute top-0 h-full border-l border-white/40 dark:border-[#424245]/50 pointer-events-none"
                style={{ left: `${pos}%`, zIndex: 10 }}
              />
            );
          })}

          {/* Hover tooltip */}
          {hover !== null && activities[hover.idx] && (() => {
            const a = activities[hover.idx];
            const cfg = TYPE_COLORS[a.type] || TYPE_COLORS.UNKNOWN;
            const tooltipLeft = Math.max(10, Math.min(hover.x - 80, (barRef.current?.clientWidth || 400) - 170));
            return (
              <div
                className="absolute z-50 pointer-events-none"
                style={{ left: tooltipLeft, bottom: BAR_H + 8 }}
              >
                <div className="rounded-lg bg-white dark:bg-[#272729] px-3 py-2 min-w-[150px]" style={{ boxShadow: 'rgba(0,0,0,0.22) 3px 5px 30px 0px' }}>
                  <p className="text-[11px] font-semibold text-ink mb-1.5">
                    {a.start.slice(8, 10)}.{a.start.slice(5, 7)}.{a.start.slice(0, 4)} {fmtTime(a.start)}
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full"
                      style={{ backgroundColor: cfg.color }}
                    >
                      <span className="text-white text-[8px] font-bold">
                        {a.type === 'DRIVING' ? '⊕' : a.type === 'WORK' ? '⚙' : a.type === 'REST' ? '◉' : '◎'}
                      </span>
                    </span>
                    <div>
                      <p className="text-[12px] text-muted">{fmtTime(a.start)} - {fmtTime(a.end)}</p>
                      <p className="text-[12px] font-semibold text-ink">{fmtHm(a.duration_minutes)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-center">
                  <div className="h-2 w-2 rotate-45 bg-white dark:bg-[#272729] -mt-1" style={{ boxShadow: '2px 2px 4px rgba(0,0,0,0.08)' }} />
                </div>
              </div>
            );
          })()}
        </div>

        {/* Hour labels */}
        <div className="relative h-5 w-full">
          <span className="absolute left-0 top-0.5 text-[11px] text-muted">
            {shift.shift_start.slice(8, 10)}.{shift.shift_start.slice(5, 7)}.{shift.shift_start.slice(0, 4)}
          </span>
          {hours.map(h => {
            const pos = ((h * 60 - startMin) / totalSpan) * 100;
            if (pos < 5 || pos > 97) return null;
            return (
              <span
                key={h}
                className="absolute top-0.5 -translate-x-1/2 text-[11px] text-muted"
                style={{ left: `${pos}%` }}
              >
                {String(h % 24).padStart(2, '0')}:00
              </span>
            );
          })}
        </div>
      </div>

      {/* Shift summary — "Podsumowanie zmiany" */}
      <div className="border-t border-[rgba(0,0,0,0.06)] dark:border-[#424245] mt-1 pt-3">
        <p className="text-[12px] font-semibold text-ink mb-2">
          {locale === 'de' ? 'Schichtzusammenfassung' : 'Podsumowanie zmiany'}
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {types.map(type => {
            const cfg = TYPE_COLORS[type];
            const min = summary[type] || 0;
            return (
              <div key={type} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: cfg.color }}
                />
                <span className="text-[12px] text-muted">
                  {locale === 'de' ? cfg.labelDe : cfg.labelPl}
                </span>
                <span className="text-[12px] font-semibold text-ink">
                  {fmtHm(min)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
