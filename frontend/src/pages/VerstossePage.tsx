import { useState, useCallback, useMemo, useRef } from 'react';
import { ShieldAlert, Play, Search, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchDrivers, analyzeDropboxFile } from '../lib/api';
import { analyzeVerstoesse, generateVerstossePdf, type VerstosseLang } from '../lib/pdf-generator';
import type { Driver, ShiftDetail } from '../types';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';

interface DriverViolationResult {
  driver_name: string;
  card_number: string;
  totalEntries: number;
  totalFahrer: number;
  totalUnternehmen: number;
  shifts: ShiftDetail[];
}

export function VerstossePage() {
  const { t, locale } = useI18n();
  const { dateFrom, dateTo } = useDateFilter();
  const { toast } = useToast();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driversLoaded, setDriversLoaded] = useState(false);
  const [results, setResults] = useState<DriverViolationResult[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [pdfLang, setPdfLang] = useState<VerstosseLang>('de');
  const cancelRef = useRef(false);

  // Load drivers on first render
  const loadDrivers = useCallback(async () => {
    if (driversLoaded) return;
    setDriversLoading(true);
    try {
      const data = await fetchDrivers();
      setDrivers(data.drivers.filter((d: Driver) => d.files.length > 0));
      setDriversLoaded(true);
    } catch {
      toast(t('errorNetwork'), 'error');
    } finally {
      setDriversLoading(false);
    }
  }, [driversLoaded, t, toast]);

  // Auto-load
  if (!driversLoaded && !driversLoading) {
    loadDrivers();
  }

  const filteredDrivers = useMemo(() => {
    if (!searchQuery) return drivers;
    const q = searchQuery.toLowerCase();
    return drivers.filter(d =>
      d.name.toLowerCase().includes(q) || d.card_number.toLowerCase().includes(q)
    );
  }, [drivers, searchQuery]);

  const toggleDriver = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredDrivers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredDrivers.map(d => d.name)));
    }
  };

  const handleGenerate = useCallback(async () => {
    if (selected.size === 0) return;
    setLoading(true);
    setResults([]);
    cancelRef.current = false;

    const selectedDrivers = drivers.filter(d => selected.has(d.name));
    setProgress({ current: 0, total: selectedDrivers.length, name: '' });

    const allResults: DriverViolationResult[] = [];
    const CONCURRENCY = 3;

    const processDriver = async (driver: Driver) => {
      if (cancelRef.current) return;
      const latestFile = driver.files[0];
      if (!latestFile?.path) return;

      setProgress(p => ({ ...p, name: driver.name }));

      try {
        const analysis = await analyzeDropboxFile(latestFile.path);
        let shifts = analysis.shift_details || [];

        // Filter by global date range
        if (dateFrom || dateTo) {
          shifts = shifts.filter((sh: ShiftDetail) => {
            const d = sh.shift_date;
            if (!d) return false;
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            return true;
          });
        }

        if (shifts.length === 0) {
          setProgress(p => ({ ...p, current: p.current + 1 }));
          return;
        }

        const driverName = driver.name;
        const cardNum = driver.card_number || analysis.driver_info?.card_number || '';
        const result = analyzeVerstoesse(driverName, cardNum, shifts as any);
        const tFahrer = result.entries.reduce((s: number, v: any) => s + v.bussgeldFahrer, 0);
        const tUnternehmen = result.entries.reduce((s: number, v: any) => s + v.bussgeldUnternehmen, 0);

        allResults.push({
          driver_name: driverName,
          card_number: cardNum,
          totalEntries: result.entries.length,
          totalFahrer: tFahrer,
          totalUnternehmen: tUnternehmen,
          shifts,
        });
      } catch {
        // skip failed
      }

      setProgress(p => ({ ...p, current: p.current + 1 }));
    };

    // Process with concurrency
    const queue = [...selectedDrivers];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0 && !cancelRef.current) {
        const driver = queue.shift()!;
        await processDriver(driver);
      }
    });
    await Promise.all(workers);

    allResults.sort((a, b) => b.totalEntries - a.totalEntries);
    setResults(allResults);
    setLoading(false);
  }, [selected, drivers, dateFrom, dateTo]);

  const handleGeneratePdf = async (result: DriverViolationResult) => {
    const res = await generateVerstossePdf(
      result.driver_name,
      result.card_number,
      result.shifts as any,
      pdfLang,
    );
    const msg = locale === 'de'
      ? `Verstöße-Dokument: ${res.totalEntries} Verstöße · Bußgeld Fahrer: ${res.totalFahrer.toFixed(2)} € · Unternehmen: ${res.totalUnternehmen.toFixed(2)} €`
      : `Dokument naruszeń: ${res.totalEntries} naruszeń · Kara kierowca: ${res.totalFahrer.toFixed(2)} € · Firma: ${res.totalUnternehmen.toFixed(2)} €`;
    toast(msg, res.totalEntries > 0 ? 'error' : 'success');
  };

  const handleGenerateAllPdfs = async () => {
    for (const result of results) {
      if (result.totalEntries > 0) {
        await generateVerstossePdf(
          result.driver_name,
          result.card_number,
          result.shifts as any,
          pdfLang,
        );
      }
    }
    const totalViolations = results.reduce((s, r) => s + r.totalEntries, 0);
    const msg = locale === 'de'
      ? `${results.filter(r => r.totalEntries > 0).length} PDF-Dokumente erstellt — ${totalViolations} Verstöße gesamt`
      : `${results.filter(r => r.totalEntries > 0).length} dokumentów PDF — ${totalViolations} naruszeń łącznie`;
    toast(msg, 'success');
  };

  const totalViolations = results.reduce((s, r) => s + r.totalEntries, 0);
  const totalFahrer = results.reduce((s, r) => s + r.totalFahrer, 0);
  const totalUnternehmen = results.reduce((s, r) => s + r.totalUnternehmen, 0);
  const driversWithViolations = results.filter(r => r.totalEntries > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 ring-1 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/20">
            <ShieldAlert size={20} className="text-red-600 dark:text-red-400" />
          </div>
          {t('verstosseTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('verstosseSubtitle')}
          {(dateFrom || dateTo) && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
              {dateFrom || '...'} — {dateTo || '...'}
            </span>
          )}
        </p>
      </div>

      {/* Driver selection */}
      <Card>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Users size={16} />
              {t('verstosseSelectDrivers')}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {selected.size} {t('driverSelected')}
              </span>
              <button
                onClick={toggleAll}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400"
              >
                {t('driverSelectAll')}
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('driversSearch')}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500/50 dark:focus:ring-blue-500/10"
            />
          </div>

          {/* Driver grid */}
          {driversLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-h-[300px] overflow-y-auto">
              {filteredDrivers.map(driver => (
                <button
                  key={driver.name}
                  onClick={() => toggleDriver(driver.name)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    selected.has(driver.name)
                      ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-white/5'
                  }`}
                >
                  <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    selected.has(driver.name)
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {selected.has(driver.name) && (
                      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </div>
                  <span className="truncate font-medium">{driver.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Language + Generate */}
          <div className="flex items-center gap-3 pt-2">
            {/* PDF language selector */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 dark:border-white/10 dark:bg-slate-800">
              {([
                { code: 'de' as VerstosseLang, label: 'DE', flag: '🇩🇪' },
                { code: 'pl' as VerstosseLang, label: 'PL', flag: '🇵🇱' },
                { code: 'en' as VerstosseLang, label: 'EN', flag: '🇬🇧' },
                { code: 'el' as VerstosseLang, label: 'EL', flag: '🇬🇷' },
              ]).map(({ code, label, flag }) => (
                <button
                  key={code}
                  onClick={() => setPdfLang(code)}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    pdfLang === code
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'
                  }`}
                >
                  <span>{flag}</span>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || selected.size === 0}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-500/20 transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Spinner size="sm" /> : <Play size={16} />}
              {t('verstosseGenerate')}
            </button>
            {loading && progress.total > 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>{progress.current}/{progress.total}</span>
                {progress.name && <span className="text-gray-400">— {progress.name}</span>}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Users size={14} className="text-gray-400" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{t('verstosseDriversAnalyzed')}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{results.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-800/50">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className={totalViolations > 0 ? 'text-red-400' : 'text-green-400'} />
                <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{t('verstosseTotalViolations')}</span>
              </div>
              <p className={`text-2xl font-bold ${totalViolations > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {totalViolations}
              </p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 dark:border-orange-500/20 dark:bg-orange-500/5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-orange-500">{t('verstosseFahrerFines')}</span>
              <p className="mt-1 text-2xl font-bold text-orange-600 dark:text-orange-400">{totalFahrer.toFixed(0)} €</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-500/20 dark:bg-red-500/5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-red-500">{t('verstosseUnternehmenFines')}</span>
              <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-300">{totalUnternehmen.toFixed(0)} €</p>
            </div>
          </div>

          {/* Export all button */}
          {driversWithViolations > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {driversWithViolations} {locale === 'de' ? 'Fahrer mit Verstößen' : 'kierowców z naruszeniami'}
              </p>
              <button
                onClick={handleGenerateAllPdfs}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-500/20 transition hover:brightness-110"
              >
                <ShieldAlert size={16} />
                {t('verstosseExportAll')}
              </button>
            </div>
          )}

          {/* Driver results table */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/10">
                    <th className="pb-3 text-left font-semibold text-gray-700 dark:text-gray-300">{t('driversName')}</th>
                    <th className="pb-3 text-left font-semibold text-gray-700 dark:text-gray-300">{t('driversCardNumber')}</th>
                    <th className="pb-3 text-center font-semibold text-gray-700 dark:text-gray-300">{t('complianceViolations')}</th>
                    <th className="pb-3 text-right font-semibold text-gray-700 dark:text-gray-300">{locale === 'de' ? 'Fahrer €' : 'Kierowca €'}</th>
                    <th className="pb-3 text-right font-semibold text-gray-700 dark:text-gray-300">{locale === 'de' ? 'Unternehmen €' : 'Firma €'}</th>
                    <th className="pb-3 text-center font-semibold text-gray-700 dark:text-gray-300">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {results.map(result => (
                    <tr key={result.card_number || result.driver_name} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                      <td className="py-3 font-medium text-gray-900 dark:text-white">{result.driver_name}</td>
                      <td className="py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{result.card_number}</td>
                      <td className="py-3 text-center">
                        {result.totalEntries > 0 ? (
                          <Badge variant="red">{result.totalEntries}</Badge>
                        ) : (
                          <Badge variant="green">
                            <CheckCircle size={12} className="mr-1" />
                            OK
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 text-right font-mono text-orange-600 dark:text-orange-400">
                        {result.totalFahrer > 0 ? `${result.totalFahrer.toFixed(2)} €` : '—'}
                      </td>
                      <td className="py-3 text-right font-mono text-red-700 dark:text-red-300">
                        {result.totalUnternehmen > 0 ? `${result.totalUnternehmen.toFixed(2)} €` : '—'}
                      </td>
                      <td className="py-3 text-center">
                        {result.totalEntries > 0 ? (
                          <button
                            onClick={() => handleGeneratePdf(result)}
                            className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                          >
                            PDF
                          </button>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr className="border-t-2 border-gray-200 dark:border-white/10 font-bold">
                    <td className="pt-3 text-gray-900 dark:text-white">{locale === 'de' ? 'GESAMT' : 'RAZEM'}</td>
                    <td className="pt-3 text-gray-500">{results.length} {locale === 'de' ? 'Fahrer' : 'kierowców'}</td>
                    <td className="pt-3 text-center">
                      <Badge variant={totalViolations > 0 ? 'red' : 'green'}>{totalViolations}</Badge>
                    </td>
                    <td className="pt-3 text-right font-mono text-orange-600 dark:text-orange-400">{totalFahrer.toFixed(2)} €</td>
                    <td className="pt-3 text-right font-mono text-red-700 dark:text-red-300">{totalUnternehmen.toFixed(2)} €</td>
                    <td className="pt-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert size={48} className="mb-4 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('verstosseNoData')}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
