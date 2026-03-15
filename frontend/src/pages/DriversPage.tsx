import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronUp, ChevronDown, FileText, AlertCircle, AlertTriangle, UserPlus } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDrivers, addDriver } from '../lib/api';
import { formatDate, formatDateTime, daysLabel, daysColor, formatBytes } from '../lib/format';
import { Card } from '../components/Card';
import { Badge, StatusDot } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { MobileCard, CardField } from '../components/MobileCards';
import type { Driver, DriverFile } from '../types';

const PAGE_SIZE = 20;
type SortField = 'name' | 'card_number' | 'earliest_date' | 'latest_date' | 'latest_download' | 'days_since' | 'file_count';

export function DriversPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('latest_download');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Driver files modal
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError('');
    fetchDrivers(refresh)
      .then((data) => { setDrivers(data.drivers); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Add driver modal
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [addingDriver, setAddingDriver] = useState(false);
  const [addDriverError, setAddDriverError] = useState('');

  const handleAddDriver = useCallback(async () => {
    if (!newDriverName.trim()) return;
    setAddingDriver(true);
    setAddDriverError('');
    try {
      await addDriver(newDriverName.trim());
      setShowAddDriver(false);
      setNewDriverName('');
      load(true);
    } catch (e: any) {
      setAddDriverError(e.message);
    } finally {
      setAddingDriver(false);
    }
  }, [newDriverName, load]);

  // Overdue drivers (>28 days without download)
  const overdueDrivers = useMemo(() => {
    return drivers.filter((d) => d.days_since !== null && d.days_since > 28);
  }, [drivers]);

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

  const analyzeFile = (f: DriverFile) => {
    const driverName = selectedDriver?.name || '';
    setSelectedDriver(null);
    const params = new URLSearchParams({ path: f.path, name: f.name, driver: driverName });
    navigate(`/analysis?${params}`);
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
    <div className="animate-slide-up">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('driversTitle')}</h1>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('driversSearch')}
            className="glass-input w-full rounded-xl py-2 pl-9 pr-3 text-sm outline-none"
          />
        </div>
        <div className="hidden sm:block flex-1" />
        <button
          onClick={() => { setShowAddDriver(true); setNewDriverName(''); setAddDriverError(''); }}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 min-h-[44px] text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110"
        >
          <UserPlus size={14} />
          {t('driversAddDriver')}
        </button>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/30 dark:border-white/10 bg-white/50 dark:bg-white/5 px-4 py-2 min-h-[44px] text-sm font-medium transition hover:bg-black/[0.03] dark:hover:bg-white/5 backdrop-blur-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('refresh')}
        </button>
      </div>

      {/* Overdue download alert */}
      {overdueDrivers.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800 dark:bg-rose-900/20">
          <AlertTriangle size={18} className="flex-shrink-0 text-rose-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{t('driversOverdueAlert')}</p>
            <p className="text-xs text-rose-600/70 dark:text-rose-400/70">
              {overdueDrivers.length} {t('driversOverdueCount')}: {overdueDrivers.slice(0, 5).map((d) => d.name).join(', ')}{overdueDrivers.length > 5 ? '...' : ''}
            </p>
          </div>
          <Badge variant="red">{overdueDrivers.length}</Badge>
        </div>
      )}

      {/* Loading / Error / Empty */}
      {loading && !drivers.length && (
        <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
          <Spinner size="lg" />
          <p>{t('loading')}</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-3 py-20 text-rose-500 animate-fade-in">
          <AlertCircle size={32} />
          <p>{error}</p>
          <button
            onClick={() => { setError(''); load(); }}
            className="mt-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 min-h-[44px] text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110"
          >
            {t('tryAgain')}
          </button>
        </div>
      )}

      {!loading && !error && !drivers.length && (
        <p className="py-20 text-center text-gray-400">{t('driversNoData')}</p>
      )}

      {/* Table (desktop) + Cards (mobile) */}
      {pageData.length > 0 && (
        <Card className="overflow-hidden">
          {/* Mobile card view */}
          <div className="block sm:hidden divide-y divide-black/[0.03] dark:divide-white/[0.03]">
            {pageData.map((d) => (
              <div
                key={d.name}
                onClick={() => openDriver(d)}
                className={`cursor-pointer p-4 transition active:bg-blue-50/50 dark:active:bg-blue-900/10 ${d.days_since !== null && d.days_since > 28 ? 'bg-rose-50/30 dark:bg-rose-900/10' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-bold truncate">{d.name}</p>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold shrink-0">
                    <StatusDot color={daysColor(d.days_since)} />
                    {daysLabel(d.days_since, locale)}
                  </span>
                </div>
                <div className="space-y-1">
                  <CardField label={t('driversCardNumber')} value={<span className="font-mono text-xs">{d.card_number}</span>} />
                  <CardField label={t('driversLastDownload')} value={formatDateTime(d.latest_download, locale)} />
                  <CardField label={t('driversFileCount')} value={<Badge variant="gray">{d.file_count}</Badge>} />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-white/20 dark:border-white/5">
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
              <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
                {pageData.map((d) => (
                  <tr
                    key={d.name}
                    onClick={() => openDriver(d)}
                    className={`cursor-pointer transition hover:bg-primary-50/50 dark:hover:bg-primary-900/10 ${d.days_since !== null && d.days_since > 28 ? 'bg-rose-50/50 dark:bg-rose-900/10' : ''}`}
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
            <div className="flex items-center justify-center gap-3 border-t border-white/20 dark:border-white/5 px-4 py-3 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg px-3 py-1 min-h-[44px] font-medium transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
              >
                {t('pagePrev')}
              </button>
              <span className="text-gray-500">{page} {t('pageOf')} {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg px-3 py-1 min-h-[44px] font-medium transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
              >
                {t('pageNext')}
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Add driver modal */}
      <Modal open={showAddDriver} onClose={() => setShowAddDriver(false)} title={t('driversAddDriver')}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('driversName')}</label>
            <input
              type="text"
              value={newDriverName}
              onChange={(e) => setNewDriverName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddDriver(); }}
              placeholder={t('driversAddNamePlaceholder')}
              autoFocus
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm outline-none"
            />
          </div>
          {addDriverError && (
            <p className="text-sm text-rose-500">{addDriverError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAddDriver(false)}
              className="rounded-lg border border-white/30 dark:border-white/10 px-4 py-2 min-h-[44px] text-sm font-medium transition hover:bg-black/[0.03] dark:hover:bg-white/5"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleAddDriver}
              disabled={!newDriverName.trim() || addingDriver}
              className="rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 min-h-[44px] text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110 disabled:opacity-50"
            >
              {addingDriver ? t('loading') : t('save')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Driver files modal - all files shown, no date filtering */}
      <Modal open={!!selectedDriver} onClose={() => setSelectedDriver(null)} title={selectedDriver ? `${selectedDriver.name}${selectedDriver.card_number ? ` (${selectedDriver.card_number})` : ''}` : ''} wide>
        {selectedDriver && (
          <div className="max-h-[60vh] divide-y divide-black/[0.03] overflow-y-auto dark:divide-white/[0.03]">
            {selectedDriver.files.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">{t('detailNoFiles')}</p>
            ) : (
              selectedDriver.files.map((f) => (
                <div
                  key={f.path}
                  className="cursor-pointer px-4 py-3 text-sm transition hover:bg-black/[0.03] dark:hover:bg-white/5"
                  onClick={() => analyzeFile(f)}
                >
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="flex-shrink-0 text-primary-500" />
                    <span className="flex-1 font-medium truncate">{f.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); analyzeFile(f); }}
                      className="shrink-0 rounded-lg border border-primary-200 px-3 py-1 min-h-[44px] text-xs font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-primary-800 dark:text-primary-400 dark:hover:bg-primary-900/20"
                    >
                      {t('detailAnalyze')}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-3 pl-6 text-xs text-gray-400">
                    <span>{formatDate(f.file_date, locale)}</span>
                    <span>{formatBytes(f.size)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Modal>

    </div>
  );
}
