import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { Badge } from '../components/Badge';
import type { ShiftDetail } from '../types';

interface Activity {
  start: string;
  end: string;
  duration_minutes: number;
  type: string;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  DRIVING: { bg: 'bg-emerald-500', text: 'text-emerald-700', label: 'Lenkzeit' },
  WORK: { bg: 'bg-blue-500', text: 'text-blue-700', label: 'Arbeitszeit' },
  REST: { bg: 'bg-amber-400', text: 'text-amber-700', label: 'Ruhezeit' },
  AVAILABILITY: { bg: 'bg-gray-400', text: 'text-gray-600', label: 'Bereitschaft' },
  UNKNOWN: { bg: 'bg-gray-200', text: 'text-gray-400', label: 'Unbekannt' },
};

function fmtHm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function fmtTime(s: string) {
  return s?.slice(11, 16) || '';
}

function parseMinutes(timeStr: string): number {
  const h = parseInt(timeStr.slice(11, 13) || '0');
  const m = parseInt(timeStr.slice(14, 16) || '0');
  return h * 60 + m;
}

export function ArbeitszeitReport({ shift }: { shift: ShiftDetail }) {
  const { t } = useI18n();
  const activities: Activity[] = (shift as any).activity_timeline || [];

  // Timeline bar: map activities to proportional widths
  const totalMin = shift.duration_minutes || 1;
  const shiftStartMin = parseMinutes(shift.shift_start);

  // Summary per type
  const summary = useMemo(() => {
    const s: Record<string, number> = {};
    for (const a of activities) {
      s[a.type] = (s[a.type] || 0) + a.duration_minutes;
    }
    return s;
  }, [activities]);

  if (activities.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Timeline bar */}
      <div className="rounded-xl bg-gray-100 dark:bg-gray-800 p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>{fmtTime(shift.shift_start)}</span>
          <span className="font-semibold text-ink">{shift.shift_date}</span>
          <span>{fmtTime(shift.shift_end)}</span>
        </div>
        <div className="flex h-8 w-full overflow-hidden rounded-lg">
          {activities.map((a, i) => {
            const pct = Math.max(0.5, (a.duration_minutes / totalMin) * 100);
            const cfg = TYPE_COLORS[a.type] || TYPE_COLORS.UNKNOWN;
            return (
              <div
                key={i}
                className={`${cfg.bg} relative transition-all hover:opacity-80`}
                style={{ width: `${pct}%` }}
                title={`${cfg.label}: ${fmtTime(a.start)} – ${fmtTime(a.end)} (${a.duration_minutes}min)`}
              />
            );
          })}
        </div>
        {/* Time axis */}
        <div className="mt-1 flex justify-between text-[9px] text-muted">
          {Array.from({ length: Math.min(12, Math.ceil(totalMin / 60) + 1) }, (_, i) => {
            const hour = Math.floor(shiftStartMin / 60) + i;
            return <span key={i}>{String(hour % 24).padStart(2, '0')}:00</span>;
          })}
        </div>
      </div>

      {/* Summary boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(['DRIVING', 'WORK', 'REST', 'AVAILABILITY'] as const).map(type => {
          const cfg = TYPE_COLORS[type];
          const min = summary[type] || 0;
          return (
            <div key={type} className="flex items-center gap-2 rounded-lg bg-black/[0.02] p-2.5 dark:bg-white/5">
              <div className={`h-3 w-3 rounded-full ${cfg.bg}`} />
              <div>
                <p className="text-[10px] font-semibold text-muted">{cfg.label}</p>
                <p className="text-sm font-bold text-ink">{fmtHm(min)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Activity table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted">Start / Ende</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted">Dauer</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activities.map((a, i) => {
              const cfg = TYPE_COLORS[a.type] || TYPE_COLORS.UNKNOWN;
              return (
                <tr key={i} className="hover:bg-surface transition">
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="font-medium">{fmtTime(a.start)}</span>
                    <span className="text-muted mx-1">–</span>
                    <span className="text-muted">{fmtTime(a.end)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{a.duration_minutes} min</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${cfg.bg}`} />
                      <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
