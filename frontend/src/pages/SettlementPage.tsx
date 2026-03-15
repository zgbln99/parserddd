import { useState, useCallback, useMemo, useRef } from 'react';
import { Download, RefreshCw, AlertCircle, Calendar, Users, Clock, Moon, UtensilsCrossed } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchDrivers, analyzeDropboxFile, exportDatevBatch, fetchDriverConfigs } from '../lib/api';
import type { SettlementDriver } from '../lib/api';
import type { DriverConfig } from '../lib/api';
import type { Driver, ShiftDetail } from '../types';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { CardField } from '../components/MobileCards';
import { minutesToHm, monthLabel } from '../lib/utils';

export function SettlementPage() {
  const { t, locale } = useI18n();
  const { dateFrom } = useDateFilter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drivers, setDrivers] = useState<SettlementDriver[]>([]);
  const [period, setPeriod] = useState('');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' });
  const cancelRef = useRef(false);

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
    cancelRef.current = false;
    setProgress({ current: 0, total: 0, name: '' });

    try {
      // Step 1: Load driver list and configs
      const [driversData, configsData] = await Promise.all([
        fetchDrivers(),
        fetchDriverConfigs(),
      ]);

      const allDrivers = driversData.drivers.filter((d: Driver) => d.files.length > 0);
      const configMap = new Map<string, DriverConfig>();
      for (const cfg of configsData.configs) {
        configMap.set(cfg.card_number, cfg);
      }

      setProgress({ current: 0, total: allDrivers.length, name: '' });

      // Step 2: Analyze each driver's latest file (3 concurrent)
      const results: SettlementDriver[] = [];
      const CONCURRENCY = 3;

      const processDriver = async (driver: Driver) => {
        if (cancelRef.current) return;
        const latestFile = driver.files[0];
        if (!latestFile?.path) return;

        try {
          const analysis = await analyzeDropboxFile(latestFile.path);
          const monthShifts = (analysis.shift_details || []).filter(
            (sh: ShiftDetail) => sh.shift_date?.slice(0, 7) === p
          );
          if (monthShifts.length === 0) return;

          const totalWork = monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.work_minutes || 0), 0);
          const totalDriving = monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.driving_minutes || 0), 0);
          const totalBreak = monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.break_minutes || 0), 0);
          const totalAvail = monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.avail_minutes || 0), 0);
          const totalN25 = monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.night_25_minutes || 0), 0);
          const totalN40 = monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.night_40_minutes || 0), 0);
          const dietCount = monthShifts.filter((sh: ShiftDetail) => sh.has_diet).length;

          const cardNumber = driver.card_number || analysis.driver_info?.card_number || '';
          const dcfg = configMap.get(cardNumber);
          const personalNr = dcfg?.personal_nr || cardNumber;
          const doubleDiet = dcfg?.double_diet === 1;
          const dietRate = dcfg?.diet_rate ?? 14.0;
          // Double diet = two separate allowances per day (14€ + 14€ = 28€/day)
          // diet_count stays the same, VMA doubles the rate
          const vmaPerDay = doubleDiet ? dietRate * 2 : dietRate;

          results.push({
            driver_name: driver.name,
            card_number: cardNumber,
            personal_nr: personalNr,
            double_diet: doubleDiet,
            diet_rate: dietRate,
            summary: {
              total_work_minutes: totalWork,
              total_work_hm: minutesToHm(totalWork),
              total_driving_minutes: totalDriving,
              total_driving_hm: minutesToHm(totalDriving),
              total_break_minutes: totalBreak,
              total_break_hm: minutesToHm(totalBreak),
              total_avail_minutes: totalAvail,
              night_25_minutes: totalN25,
              night_25_hm: minutesToHm(totalN25),
              night_40_minutes: totalN40,
              night_40_hm: minutesToHm(totalN40),
              diet_count: dietCount,
              effective_diet_count: dietCount,
              vma_amount: dietCount * vmaPerDay,
              total_shifts: monthShifts.length,
            },
            shifts: monthShifts,
          });
        } catch {
          // skip failed drivers
        }
      };

      // Process in batches of CONCURRENCY
      for (let i = 0; i < allDrivers.length; i += CONCURRENCY) {
        if (cancelRef.current) break;
        const batch = allDrivers.slice(i, i + CONCURRENCY);
        setProgress({ current: i, total: allDrivers.length, name: batch.map(d => d.name).join(', ') });
        await Promise.all(batch.map(processDriver));
      }

      results.sort((a, b) => a.driver_name.localeCompare(b.driver_name));
      setDrivers(results);
      setPeriod(p);
      setProgress({ current: allDrivers.length, total: allDrivers.length, name: '' });
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

  const fmtDec = (min: number) => (min / 60).toFixed(2).replace('.', ',');

  const fmtEur = (val: number) => val.toFixed(2).replace('.', ',') + ' €';

  return (
    <div className="animate-slide-up">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('settlementTitle')}</h1>

      {/* Period selector */}
      <Card className="mb-6 p-3 sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
              {t('settlementPeriod')}
            </label>
            <input
              type="month"
              value={selectedPeriod || defaultPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="glass-input rounded-xl px-3 py-2 text-sm outline-none"
            />
          </div>
          <button
            onClick={loading ? () => { cancelRef.current = true; } : handleGenerate}
            className={`flex min-h-[44px] items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white transition ${
              loading ? 'bg-rose-600 hover:bg-rose-700' : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Calendar size={14} />}
            {loading ? t('cancel') : t('settlementGenerate')}
          </button>
          {drivers.length > 0 && (
            <button
              onClick={handleExportDatev}
              disabled={exporting}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-50"
            >
              <Download size={14} />
              {exporting ? t('loading') : t('settlementExportDatev')}
            </button>
          )}
        </div>
      </Card>

      {/* Loading with progress */}
      {loading && (
        <Card className="mb-6 p-6">
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('settlementLoading')}</p>
            {progress.total > 0 && (
              <>
                <div className="w-full max-w-md">
                  <div className="mb-1 flex justify-between text-xs text-gray-500">
                    <span>{progress.current} / {progress.total}</span>
                    <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all duration-300"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                </div>
                {progress.name && (
                  <p className="text-xs text-gray-400">{progress.name}</p>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center gap-3 py-12 text-rose-500">
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
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
              <p className="text-2xl font-bold">{fmtDec(totals.n25)}</p>
              <p className="text-xs text-gray-500">{t('analysisNight25')}</p>
            </Card>
            <Card className="p-4 text-center">
              <Moon size={20} className="mx-auto mb-1 text-purple-500" />
              <p className="text-2xl font-bold">{fmtDec(totals.n40)}</p>
              <p className="text-xs text-gray-500">{t('analysisNight40')}</p>
            </Card>
            <Card className="p-4 text-center">
              <UtensilsCrossed size={20} className="mx-auto mb-1 text-amber-500" />
              <p className="text-2xl font-bold">{totals.diets}</p>
              <p className="text-xs text-gray-500">{t('analysisDiet')}</p>
            </Card>
            <Card className="p-4 text-center">
              <Download size={20} className="mx-auto mb-1 text-emerald-500" />
              <p className="text-2xl font-bold">{fmtEur(totals.vma)}</p>
              <p className="text-xs text-gray-500">VMA</p>
            </Card>
          </div>

          {/* Driver table */}
          <Card className="overflow-hidden">
            <div className="border-b border-white/20 px-5 py-3 dark:border-white/5">
              <h2 className="text-sm font-semibold">
                {monthLabel(period, locale)} — {drivers.length} {t('settlementDrivers').toLowerCase()}
              </h2>
            </div>
            {/* Mobile card view */}
            <div className="block sm:hidden divide-y divide-black/[0.03] dark:divide-white/[0.03]">
              {drivers.map((d, i) => (
                <div key={d.card_number || d.driver_name} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-bold truncate">
                      <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                      {d.driver_name}
                    </p>
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{fmtEur(d.summary.vma_amount)}</span>
                  </div>
                  {d.personal_nr && <CardField label={t('settlementPersonalNr')} value={<span className="font-mono text-xs">{d.personal_nr}</span>} />}
                  <CardField label={t('analysisShifts')} value={<Badge variant="gray">{d.summary.total_shifts}</Badge>} />
                  <CardField label={t('analysisWorkTime')} value={<span className="font-mono">{d.summary.total_work_hm}</span>} />
                  <CardField label={t('analysisNight25')} value={<span className="font-mono text-indigo-600 dark:text-indigo-400">{fmtDec(d.summary.night_25_minutes)}</span>} />
                  <CardField label={t('analysisNight40')} value={<span className="font-mono text-purple-600 dark:text-purple-400">{fmtDec(d.summary.night_40_minutes)}</span>} />
                  <CardField label={t('analysisDiet')} value={
                    d.summary.diet_count > 0
                      ? <Badge variant={d.double_diet ? 'blue' : 'gray'}>{d.summary.diet_count}{d.double_diet ? ' (2×14€)' : ''}</Badge>
                      : '-'
                  } />
                </div>
              ))}
              {/* Mobile totals */}
              <div className="p-4 bg-black/[0.02] dark:bg-white/5 space-y-1.5">
                <p className="text-sm font-bold mb-2">{t('settlementTotal')}</p>
                <CardField label={t('analysisShifts')} value={<span className="font-bold">{totals.shifts}</span>} />
                <CardField label={t('analysisWorkTime')} value={<span className="font-mono font-bold">{fmtH(totals.work)}</span>} />
                <CardField label={t('analysisNight25')} value={<span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{fmtDec(totals.n25)}</span>} />
                <CardField label={t('analysisNight40')} value={<span className="font-mono font-bold text-purple-600 dark:text-purple-400">{fmtDec(totals.n40)}</span>} />
                <CardField label={t('analysisDiet')} value={<span className="font-bold">{totals.diets}</span>} />
                <CardField label="VMA" value={<span className="font-bold text-emerald-600 dark:text-emerald-400">{fmtEur(totals.vma)}</span>} />
              </div>
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-white/20 dark:border-white/5">
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
                <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
                  {drivers.map((d, i) => (
                    <tr key={d.card_number || d.driver_name} className="transition hover:bg-primary-50/30 dark:hover:bg-primary-900/10">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{d.personal_nr}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">{d.driver_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Badge variant="gray">{d.summary.total_shifts}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{d.summary.total_work_hm}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-indigo-600 dark:text-indigo-400">{fmtDec(d.summary.night_25_minutes)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-purple-600 dark:text-purple-400">{fmtDec(d.summary.night_40_minutes)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {d.summary.diet_count > 0 ? (
                          <Badge variant={d.double_diet ? 'blue' : 'gray'}>
                            {d.summary.diet_count}{d.double_diet ? ' (2×14€)' : ''}
                          </Badge>
                        ) : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                        {fmtEur(d.summary.vma_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-white/30 bg-black/[0.02] font-semibold dark:border-white/10 dark:bg-white/5">
                    <td className="px-4 py-3" colSpan={3}>{t('settlementTotal')}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{totals.shifts}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{fmtH(totals.work)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-indigo-600 dark:text-indigo-400">{fmtDec(totals.n25)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-purple-600 dark:text-purple-400">{fmtDec(totals.n40)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{totals.diets}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{fmtEur(totals.vma)}</td>
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
