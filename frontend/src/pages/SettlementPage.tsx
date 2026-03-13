import { useState, useCallback, useMemo } from 'react';
import { Download, RefreshCw, AlertCircle, Calendar, Users, Clock, Moon, UtensilsCrossed } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchSettlement, exportDatevBatch } from '../lib/api';
import type { SettlementDriver } from '../lib/api';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';

export function SettlementPage() {
  const { t, locale } = useI18n();
  const { dateFrom } = useDateFilter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drivers, setDrivers] = useState<SettlementDriver[]>([]);
  const [period, setPeriod] = useState('');
  const [exporting, setExporting] = useState(false);

  // Derive default period from global date filter or current month
  const defaultPeriod = useMemo(() => {
    if (dateFrom) return dateFrom.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [dateFrom]);

  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);

  const handleGenerate = useCallback(async () => {
    const p = selectedPeriod || defaultPeriod;
    setLoading(true);
    setError('');
    setDrivers([]);
    setPeriod('');
    try {
      const data = await fetchSettlement(p);
      setDrivers(data.drivers);
      setPeriod(data.period);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, defaultPeriod]);

  const handleExportDatev = useCallback(async () => {
    if (!drivers.length || !period) return;
    setExporting(true);
    try {
      await exportDatevBatch(period, drivers);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }, [drivers, period]);

  // Totals
  const totals = useMemo(() => {
    let work = 0, n25 = 0, n40 = 0, diets = 0, vma = 0, shifts = 0;
    for (const d of drivers) {
      work += d.summary.total_work_minutes;
      n25 += d.summary.night_25_minutes;
      n40 += d.summary.night_40_minutes;
      diets += d.summary.effective_diet_count;
      vma += d.summary.vma_amount;
      shifts += d.summary.total_shifts;
    }
    return { work, n25, n40, diets, vma, shifts };
  }, [drivers]);

  const fmtH = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  const fmtEur = (val: number) => {
    return val.toFixed(2).replace('.', ',') + ' €';
  };

  const monthLabel = (p: string) => {
    if (!p) return '';
    const [y, m] = p.split('-');
    const months = locale === 'de'
      ? ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
      : ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('settlementTitle')}</h1>

      {/* Period selector */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
              {t('settlementPeriod')}
            </label>
            <input
              type="month"
              value={selectedPeriod || defaultPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Calendar size={14} />}
            {t('settlementGenerate')}
          </button>
          {drivers.length > 0 && (
            <button
              onClick={handleExportDatev}
              disabled={exporting}
              className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              <Download size={14} />
              {exporting ? t('loading') : t('settlementExportDatev')}
            </button>
          )}
        </div>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
          <Spinner size="lg" />
          <p>{t('settlementLoading')}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center gap-3 py-12 text-red-500">
          <AlertCircle size={32} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !drivers.length && !period && (
        <p className="py-20 text-center text-sm text-gray-400">{t('settlementNoData')}</p>
      )}

      {/* Results */}
      {drivers.length > 0 && period && (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Card className="p-4 text-center">
              <Users size={20} className="mx-auto mb-1 text-primary-500" />
              <p className="text-2xl font-bold">{drivers.length}</p>
              <p className="text-xs text-gray-500">{t('settlementDrivers')}</p>
            </Card>
            <Card className="p-4 text-center">
              <Clock size={20} className="mx-auto mb-1 text-blue-500" />
              <p className="text-2xl font-bold">{fmtH(totals.work)}</p>
              <p className="text-xs text-gray-500">{t('analysisWorkTime')}</p>
            </Card>
            <Card className="p-4 text-center">
              <Moon size={20} className="mx-auto mb-1 text-indigo-500" />
              <p className="text-2xl font-bold">{fmtH(totals.n25)}</p>
              <p className="text-xs text-gray-500">{t('analysisNight25')}</p>
            </Card>
            <Card className="p-4 text-center">
              <Moon size={20} className="mx-auto mb-1 text-purple-500" />
              <p className="text-2xl font-bold">{fmtH(totals.n40)}</p>
              <p className="text-xs text-gray-500">{t('analysisNight40')}</p>
            </Card>
            <Card className="p-4 text-center">
              <UtensilsCrossed size={20} className="mx-auto mb-1 text-orange-500" />
              <p className="text-2xl font-bold">{totals.diets}</p>
              <p className="text-xs text-gray-500">{t('analysisDiet')}</p>
            </Card>
            <Card className="p-4 text-center">
              <Download size={20} className="mx-auto mb-1 text-green-500" />
              <p className="text-2xl font-bold">{fmtEur(totals.vma)}</p>
              <p className="text-xs text-gray-500">VMA</p>
            </Card>
          </div>

          {/* Driver table */}
          <Card className="overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-3 dark:border-gray-800 dark:bg-gray-900/50">
              <h2 className="text-sm font-semibold">
                {monthLabel(period)} — {drivers.length} {t('settlementDrivers').toLowerCase()}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-900/30">
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">#</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('settlementPersonalNr')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('driversName')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">{t('analysisShifts')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">{t('analysisWorkTime')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">{t('analysisNight25')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">{t('analysisNight40')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">{t('analysisDiet')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">VMA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {drivers.map((d, i) => (
                    <tr key={d.card_number || d.driver_name} className="transition hover:bg-primary-50/30 dark:hover:bg-primary-900/10">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{d.personal_nr}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">{d.driver_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Badge variant="gray">{d.summary.total_shifts}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{d.summary.total_work_hm}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-indigo-600 dark:text-indigo-400">{d.summary.night_25_hm}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-purple-600 dark:text-purple-400">{d.summary.night_40_hm}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {d.summary.effective_diet_count > 0 ? (
                          <Badge variant={d.double_diet ? 'blue' : 'gray'}>
                            {d.summary.effective_diet_count}{d.double_diet ? ' (2×)' : ''}
                          </Badge>
                        ) : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-green-600 dark:text-green-400">
                        {fmtEur(d.summary.vma_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50/80 font-semibold dark:border-gray-700 dark:bg-gray-900/50">
                    <td className="px-4 py-3" colSpan={3}>{t('settlementTotal')}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{totals.shifts}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{fmtH(totals.work)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-indigo-600 dark:text-indigo-400">{fmtH(totals.n25)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-purple-600 dark:text-purple-400">{fmtH(totals.n40)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{totals.diets}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-green-600 dark:text-green-400">{fmtEur(totals.vma)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
