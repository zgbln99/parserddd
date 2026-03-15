import { useCallback } from 'react';
import { Printer } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatDate } from '../../lib/format';
import { Badge } from '../../components/Badge';
import type { ShiftDetail } from '../../types';

const weekdayMap: Record<string, Record<string, string>> = {
  de: { Pn: 'Mo', Wt: 'Di', Śr: 'Mi', Cz: 'Do', Pt: 'Fr', So: 'Sa', Nd: 'So' },
};

function localizeWeekday(wd: string, locale: string): string {
  return weekdayMap[locale]?.[wd] ?? wd;
}

interface DietReportProps {
  shifts: ShiftDetail[];
  driverName: string;
  cardNumber: string;
  summary: { diet_count: number; total_shifts: number };
}

export function DietReport({ shifts, driverName, cardNumber, summary }: DietReportProps) {
  const { t, locale } = useI18n();

  const handlePrint = useCallback(() => {
    const pw = window.open('', '_blank');
    if (!pw) return;

    const dietRows = shifts.map((sh) => {
      const wd = localizeWeekday(sh.weekday, locale);
      const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
      return `<tr${isWeekend ? ' style="color:#999"' : ''}>
        <td>${sh.shift_date}</td>
        <td>${wd}</td>
        <td>${sh.duration_hm}</td>
        <td style="text-align:center;font-weight:bold;${sh.has_diet ? 'color:#16a34a' : 'color:#ccc'}">${sh.has_diet ? t('yes') : t('no')}</td>
      </tr>`;
    }).join('');

    pw.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${driverName} — ${t('dietReport')}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  .meta { color: #666; margin-bottom: 12px; font-size: 11px; }
  .summary { margin-bottom: 16px; font-size: 14px; }
  .summary b { font-size: 20px; color: #16a34a; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ccc; padding: 5px 10px; text-align: left; }
  th { background: #f5f5f5; font-size: 10px; text-transform: uppercase; }
  @media print { body { margin: 10px; } }
</style></head><body>
  <h1>${t('dietReport')}</h1>
  <div class="meta">${driverName} &mdash; ${cardNumber}</div>
  <div class="summary">${t('analysisDietCount')}: <b>${summary.diet_count}</b> / ${summary.total_shifts} ${t('analysisShifts').toLowerCase()}</div>
  <table>
    <thead><tr>
      <th>${t('syncDate')}</th>
      <th>${t('analysisWeekday')}</th>
      <th>${t('analysisDuration')}</th>
      <th>${t('analysisDiet')}</th>
    </tr></thead>
    <tbody>${dietRows}</tbody>
  </table>
</body></html>`);
    pw.document.close();
    pw.focus();
    pw.print();
  }, [shifts, driverName, cardNumber, summary, t, locale]);

  return (
    <div className="overflow-hidden px-2 sm:px-4 pb-4">
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-white/30 dark:border-white/10">
            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('syncDate')}</th>
            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('analysisWeekday')}</th>
            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('analysisDuration')}</th>
            <th className="px-2 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">{t('analysisDiet')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
          {shifts.map((sh, i) => {
            const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
            return (
              <tr key={i} className={isWeekend ? 'text-gray-400 dark:text-gray-600' : ''}>
                <td className="whitespace-nowrap px-2 py-1.5 font-medium">{sh.shift_date}</td>
                <td className={`whitespace-nowrap px-2 py-1.5 font-bold ${isWeekend ? 'text-rose-400' : ''}`}>{localizeWeekday(sh.weekday, locale)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{sh.duration_hm}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-center">
                  {sh.has_diet
                    ? <Badge variant="green">{t('yes')}</Badge>
                    : <span className="text-gray-300 dark:text-gray-600">{t('no')}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex justify-end">
        <button
          onClick={handlePrint}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/30 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5"
        >
          <Printer size={13} />
          {t('analysisPrint')}
        </button>
      </div>
    </div>
  );
}
