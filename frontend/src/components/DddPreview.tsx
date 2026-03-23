import { useState } from 'react';
import { Binary, FileText, User, Car, MapPin, Calendar, AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';
import type { DddPreviewData } from '../types';

type PreviewTab = 'info' | 'hex' | 'activities' | 'vehicles' | 'places' | 'events';

export function DddPreview({ data }: { data: DddPreviewData }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<PreviewTab>('info');
  const [hexPage, setHexPage] = useState(0);
  const hexPageSize = 512; // bytes per page
  const totalHexPages = Math.ceil((data.hex_dump?.length || 0) / (hexPageSize * 2));

  const tabs: { key: PreviewTab; icon: typeof FileText; label: string }[] = [
    { key: 'info', icon: User, label: t('dddPreviewInfo') },
    { key: 'hex', icon: Binary, label: t('dddPreviewHex') },
    { key: 'activities', icon: Calendar, label: t('dddPreviewActivities') },
    { key: 'vehicles', icon: Car, label: t('dddPreviewVehicles') },
    { key: 'places', icon: MapPin, label: t('dddPreviewPlaces') },
    { key: 'events', icon: AlertTriangle, label: t('dddPreviewEvents') },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-black/[0.04] p-1 dark:bg-white/5">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              tab === key
                ? 'bg-white text-ink shadow-sm dark:bg-white/10'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Card Info */}
      {tab === 'info' && data.card_info && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(data.card_info).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-black/[0.02] px-4 py-3 dark:bg-white/5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {key.replace(/_/g, ' ')}
                </span>
                <span className="mt-0.5 block text-sm font-medium text-ink">{String(value) || '—'}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-black/[0.02] px-4 py-3 dark:bg-white/5">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
              {t('dddPreviewFileSize')}
            </span>
            <span className="mt-0.5 block text-sm font-medium text-ink">
              {data.file_size ? `${(data.file_size / 1024).toFixed(1)} KB` : '—'}
            </span>
          </div>
        </div>
      )}

      {/* Hex Dump */}
      {tab === 'hex' && data.hex_dump && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-muted">
              {t('dddPreviewOffset')} {(hexPage * hexPageSize).toString(16).toUpperCase().padStart(6, '0')}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setHexPage(Math.max(0, hexPage - 1))}
                disabled={hexPage === 0}
                className="rounded px-2 py-0.5 text-xs font-medium text-muted transition hover:bg-surface disabled:opacity-30"
              >
                &lt;
              </button>
              <span className="px-2 py-0.5 text-xs text-muted">{hexPage + 1}/{totalHexPages}</span>
              <button
                onClick={() => setHexPage(Math.min(totalHexPages - 1, hexPage + 1))}
                disabled={hexPage >= totalHexPages - 1}
                className="rounded px-2 py-0.5 text-xs font-medium text-muted transition hover:bg-surface disabled:opacity-30"
              >
                &gt;
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-green-400">
            <pre className="font-mono text-[11px] leading-5">
              {formatHexDump(data.hex_dump, hexPage * hexPageSize, hexPageSize)}
            </pre>
          </div>
        </div>
      )}

      {/* Activities */}
      {tab === 'activities' && (
        <div className="max-h-[400px] overflow-y-auto">
          {data.activity_records && data.activity_records.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('syncDate')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('dddPreviewActivity')}</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted">{t('dddPreviewRecords')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.activity_records.map((rec, i) => (
                  <tr key={i} className="hover:bg-surface">
                    <td className="px-3 py-2 font-mono">{rec.date}</td>
                    <td className="px-3 py-2">{rec.total_activities} {t('dddPreviewChanges')}</td>
                    <td className="px-3 py-2 text-right font-mono">{rec.driving_minutes || 0}m {t('analysisDriving')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
          )}
        </div>
      )}

      {/* Vehicles */}
      {tab === 'vehicles' && (
        <div className="max-h-[400px] overflow-y-auto">
          {data.vehicle_records && data.vehicle_records.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('analysisVehicle')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('detailFrom')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('detailTo')}</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted">km</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.vehicle_records.map((v, i) => (
                  <tr key={i} className="hover:bg-surface">
                    <td className="px-3 py-2 font-semibold">{v.plate}</td>
                    <td className="px-3 py-2 font-mono">{v.first_use}</td>
                    <td className="px-3 py-2 font-mono">{v.last_use}</td>
                    <td className="px-3 py-2 text-right font-mono">{v.odometer_end_km - v.odometer_begin_km}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
          )}
        </div>
      )}

      {/* Places */}
      {tab === 'places' && (
        <div className="max-h-[400px] overflow-y-auto">
          {data.card_places && data.card_places.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('syncDate')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('dddPreviewCountry')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('dddPreviewRegion')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('tollBookingType')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.card_places.map((p, i) => (
                  <tr key={i} className="hover:bg-surface">
                    <td className="px-3 py-2 font-mono">{p.date}</td>
                    <td className="px-3 py-2">{p.country}</td>
                    <td className="px-3 py-2">{p.region}</td>
                    <td className="px-3 py-2">{p.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
          )}
        </div>
      )}

      {/* Events */}
      {tab === 'events' && (
        <div className="max-h-[400px] overflow-y-auto">
          {data.card_events && data.card_events.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('dddPreviewEventType')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('analysisStart')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted">{t('analysisEnd')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.card_events.map((ev, i) => (
                  <tr key={i} className="hover:bg-surface">
                    <td className="px-3 py-2">{ev.event_type || '—'}</td>
                    <td className="px-3 py-2 font-mono">{ev.begin_time || '—'}</td>
                    <td className="px-3 py-2 font-mono">{ev.end_time || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Format hex string into classic hex dump with addresses and ASCII */
function formatHexDump(hex: string, offset: number, pageSize: number): string {
  const startByte = offset;
  const endByte = Math.min(offset + pageSize, hex.length / 2);
  const lines: string[] = [];

  for (let i = startByte; i < endByte; i += 16) {
    const addr = i.toString(16).toUpperCase().padStart(6, '0');
    const hexParts: string[] = [];
    const asciiParts: string[] = [];

    for (let j = 0; j < 16; j++) {
      const byteIdx = (i + j) * 2;
      if (byteIdx + 2 <= hex.length) {
        const byte = hex.slice(byteIdx, byteIdx + 2);
        hexParts.push(byte);
        const charCode = parseInt(byte, 16);
        asciiParts.push(charCode >= 32 && charCode <= 126 ? String.fromCharCode(charCode) : '.');
      } else {
        hexParts.push('  ');
        asciiParts.push(' ');
      }
    }

    const hexStr = hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ');
    lines.push(`${addr}  ${hexStr}  |${asciiParts.join('')}|`);
  }

  return lines.join('\n');
}
