import { useState } from 'react';
import { useI18n } from '../../i18n';

interface VehicleRecord {
  plate: string;
  first_use: string;
  last_use: string;
  odometer_begin_km?: number;
  odometer_end_km?: number;
  distance_km?: number;
}

export interface VehicleUsageTableProps {
  vehicles: VehicleRecord[];
  dateFrom?: string;
  dateTo?: string;
}

export function VehicleUsageTable({ vehicles, dateFrom, dateTo }: VehicleUsageTableProps) {
  const { locale } = useI18n();
  const [showVehicleKm, setShowVehicleKm] = useState(false);

  const allV = vehicles || [];
  if (allV.length === 0) return null;

  // Filter by date range
  const filtered = allV.filter((v) => {
    if (!dateFrom && !dateTo) return true;
    const fromIso = (v.first_use || '').slice(0, 10);
    const toIso = (v.last_use || '').slice(0, 10);
    if (dateTo && fromIso && fromIso > dateTo) return false;
    if (dateFrom && toIso && toIso < dateFrom) return false;
    return true;
  });
  if (filtered.length === 0) return null;

  const fmtNum = (n: number) => n.toLocaleString(locale === 'de' ? 'de-DE' : 'pl-PL');

  // Format "02. März 2026"
  const months = locale === 'de'
    ? ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
    : ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

  const fmtDate = (s: string) => {
    if (!s || s.length < 10) return '—';
    const d = parseInt(s.slice(8, 10), 10);
    const m = parseInt(s.slice(5, 7), 10) - 1;
    const y = s.slice(0, 4);
    return `${String(d).padStart(2, '0')}. ${months[m]} ${y}`;
  };

  const fmtTime = (s: string) => s && s.length >= 16 ? s.slice(11, 16) : '—';

  // ISO week
  const isoWeek = (isoDate: string) => {
    if (!isoDate) return '';
    const d = new Date(isoDate.slice(0, 10));
    const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return String(Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7));
  };

  // Duration between first_use and last_use -> HH:MM
  const fmtDuration = (from: string, to: string) => {
    if (!from || !to) return '—';
    const f = new Date(from.replace(' ', 'T'));
    const t = new Date(to.replace(' ', 'T'));
    if (isNaN(f.getTime()) || isNaN(t.getTime())) return '—';
    const mins = Math.max(0, Math.round((t.getTime() - f.getTime()) / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const totalDistance = filtered.reduce((sum, v) => sum + (v.distance_km ?? Math.max(0, (v.odometer_end_km || 0) - (v.odometer_begin_km || 0))), 0);

  return (
    <div className="space-y-0">
      <button
        onClick={() => setShowVehicleKm(!showVehicleKm)}
        className="flex w-full items-center gap-2 rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card px-4 py-3 text-left transition hover:opacity-80"
      >
        <span className={`text-muted transition-transform ${showVehicleKm ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-sm font-semibold uppercase tracking-wider text-muted">
          {locale === 'de' ? `Fahrzeugnutzung (${filtered.length} Aufzeichnungen)` : `Wykorzystanie pojazdów (${filtered.length} rekordów)`}
        </span>
        <span className="ml-auto text-sm font-bold text-ink">
          {fmtNum(totalDistance)} KM
        </span>
      </button>
      {showVehicleKm && <div className="rounded-xl border border-border overflow-x-auto mt-2">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border bg-[#f7f9fc] dark:bg-[#1f2a37]">
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted">KW</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted">{locale === 'de' ? 'Datum' : 'Data'}</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted">{locale === 'de' ? 'Zeitraum' : 'Godziny'}</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted">{locale === 'de' ? 'Dauer' : 'Czas'}</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted">{locale === 'de' ? 'Fahrzeug' : 'Pojazd'}</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-muted">Tacho {locale === 'de' ? 'Anfang' : 'początek'}</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-muted">Tacho {locale === 'de' ? 'Ende' : 'koniec'}</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-muted">{locale === 'de' ? 'Entfernung' : 'Przejechane'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((v, i) => {
              const dist = v.distance_km ?? Math.max(0, (v.odometer_end_km || 0) - (v.odometer_begin_km || 0));
              return (
                <tr key={i} className="hover:bg-surface">
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{isoWeek(v.first_use)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{fmtDate(v.first_use)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtTime(v.first_use)} – {fmtTime(v.last_use)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDuration(v.first_use, v.last_use)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold">{v.plate}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">
                    {v.odometer_begin_km ? `${fmtNum(v.odometer_begin_km)} KM` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">
                    {v.odometer_end_km ? `${fmtNum(v.odometer_end_km)} KM` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-ink">
                    {fmtNum(dist)} KM
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-[#f7f9fc] dark:bg-[#1f2a37]">
              <td colSpan={7} className="px-3 py-2.5 text-right text-sm font-bold text-ink">
                {locale === 'de' ? 'Gesamt' : 'Suma'}:
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-base font-bold text-ink">
                {fmtNum(totalDistance)} KM
              </td>
            </tr>
          </tfoot>
        </table>
      </div>}
    </div>
  );
}
