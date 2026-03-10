import { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, RefreshCw, ChevronUp, ChevronDown, FileText, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDrivers, analyzeDropboxFile } from '../lib/api';
import { formatDate, formatDateTime, daysLabel, daysColor, formatBytes } from '../lib/format';
import { Card } from '../components/Card';
import { Badge, StatusDot } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { AnalysisView } from '../features/AnalysisView';
import type { Driver, DriverFile, AnalysisResult } from '../types';

const PAGE_SIZE = 20;
type SortField = 'name' | 'card_number' | 'earliest_date' | 'latest_date' | 'latest_download' | 'days_since' | 'file_count';

export function DriversPage() {
  const { t, locale } = useI18n();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('latest_download');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Driver files modal
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);

  // Analysis modal
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisTitle, setAnalysisTitle] = useState('');

  // Date filter for analysis (shifts), not files
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError('');
    fetchDrivers(refresh)
      .then((data) => { setDrivers(data.drivers); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = drivers;
    if (q) {
      list = list.filter(
        (d) => d.name.toLowerCase().includes(q) || d.card_number.toLowerCase().includes(q),
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      if (av === null) return 1;
      if (bv === null) return -1;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return list;
  }, [drivers, search, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'days_since' ? 'asc' : 'desc');
    }
  };

  const openDriver = (d: Driver) => {
    setSelectedDriver(d);
  };

  const analyzeFile = async (f: DriverFile) => {
    // Close files modal first so analysis opens cleanly on top
    setSelectedDriver(null);
    setAnalysisTitle(f.name);
    setAnalysisData(null);
    setAnalysisLoading(true);
    setAnalysisOpen(true);
    setDateFrom('');
    setDateTo('');
    try {
      const result = await analyzeDropboxFile(f.path);
      setAnalysisData(result);
    } catch (e: any) {
      setAnalysisData({ error: e.message } as any);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronUp size={12} className="opacity-20" />;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-primary-500" />
      : <ChevronDown size={12} className="text-primary-500" />;
  };

  const cols: { field: SortField; label: string }[] = [
    { field: 'name', label: t('driversName') },
    { field: 'card_number', label: t('driversCardNumber') },
    { field: 'earliest_date', label: t('driversFileStart') },
    { field: 'latest_date', label: t('driversFileEnd') },
    { field: 'latest_download', label: t('driversLastDownload') },
    { field: 'days_since', label: t('driversDaysSince') },
    { field: 'file_count', label: t('driversFileCount') },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('driversTitle')}</h1>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('driversSearch')}
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-primary-500 dark:focus:ring-primary-900/40"
          />
        </div>
        <div className="flex-1" />
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('refresh')}
        </button>
      </div>

      {/* Loading / Error / Empty */}
      {loading && !drivers.length && (
        <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
          <Spinner size="lg" />
          <p>{t('loading')}</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-3 py-20 text-red-500">
          <AlertCircle size={32} />
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && !drivers.length && (
        <p className="py-20 text-center text-gray-400">{t('driversNoData')}</p>
      )}

      {/* Table */}
      {pageData.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                  {cols.map(({ field, label }) => (
                    <th
                      key={field}
                      onClick={() => handleSort(field)}
                      className="cursor-pointer whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 select-none hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <SortIcon field={field} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {pageData.map((d) => (
                  <tr
                    key={d.name}
                    onClick={() => openDriver(d)}
                    className="cursor-pointer transition hover:bg-primary-50/50 dark:hover:bg-primary-900/10"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">{d.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{d.card_number}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{formatDate(d.earliest_date, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{formatDate(d.latest_date, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{formatDateTime(d.latest_download, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                        <StatusDot color={daysColor(d.days_since)} />
                        {daysLabel(d.days_since, locale)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant="gray">{d.file_count}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 border-t border-gray-100 px-4 py-3 text-sm dark:border-gray-800">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg px-3 py-1 font-medium transition hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
              >
                {t('pagePrev')}
              </button>
              <span className="text-gray-500">{page} {t('pageOf')} {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg px-3 py-1 font-medium transition hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
              >
                {t('pageNext')}
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Driver files modal - all files shown, no date filtering */}
      <Modal open={!!selectedDriver} onClose={() => setSelectedDriver(null)} title={selectedDriver ? `${selectedDriver.name}${selectedDriver.card_number ? ` (${selectedDriver.card_number})` : ''}` : ''} wide>
        {selectedDriver && (
          <div className="max-h-[60vh] divide-y divide-gray-50 overflow-y-auto dark:divide-gray-800">
            {selectedDriver.files.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">{t('detailNoFiles')}</p>
            ) : (
              selectedDriver.files.map((f) => (
                <div
                  key={f.path}
                  className="flex cursor-pointer items-center gap-3 px-5 py-3 text-sm transition hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  onClick={() => analyzeFile(f)}
                >
                  <FileText size={16} className="flex-shrink-0 text-primary-500" />
                  <span className="flex-1 font-medium">{f.name}</span>
                  <span className="text-xs text-gray-400">{formatDate(f.file_date, locale)}</span>
                  <span className="text-xs text-gray-400">{formatBytes(f.size)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); analyzeFile(f); }}
                    className="rounded-lg border border-primary-200 px-3 py-1 text-xs font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-primary-800 dark:text-primary-400 dark:hover:bg-primary-900/20"
                  >
                    {t('detailAnalyze')}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </Modal>

      {/* Analysis modal with date filter for shifts */}
      <Modal open={analysisOpen} onClose={() => setAnalysisOpen(false)} title={analysisTitle} wide>
        {analysisLoading && (
          <div className="flex flex-col items-center gap-3 py-12 text-gray-400">
            <Spinner size="lg" />
            <p>{t('analysisLoading')}</p>
          </div>
        )}
        {!analysisLoading && analysisData?.error && (
          <p className="py-8 text-center text-red-500">{analysisData.error}</p>
        )}
        {!analysisLoading && analysisData && !analysisData.error && (
          <AnalysisView data={analysisData} dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
        )}
      </Modal>
    </div>
  );
}
