import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Layers, X } from 'lucide-react';
import { playNotificationSound } from '../components/Notifications';
import { useI18n } from '../i18n';
import { analyzeDropboxFile, analyzeMergedDropboxFiles, fetchDrivers } from '../lib/api';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { AnalysisView } from '../features/AnalysisView';
import { useDateFilter } from '../hooks/useDateFilter';
import type { AnalysisResult, DriverFile } from '../types';

type MergedAnalysisResult = AnalysisResult & {
  merged?: boolean;
  merged_files?: string[];
  merged_days?: number;
};

function fileLabel(f: DriverFile): string {
  return f.file_date || f.name || f.path;
}

export function AnalysisPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filePath = params.get('path') || '';
  const fileName = params.get('name') || t('analysisTitle');
  const driverName = params.get('driver') || '';
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useDateFilter();

  const [data, setData] = useState<MergedAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timerStart, setTimerStart] = useState(0);
  const [timerNow, setTimerNow] = useState(0);

  // Merge another card (old/new card in the same month).
  const [otherFiles, setOtherFiles] = useState<DriverFile[]>([]);
  const [extraPaths, setExtraPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!loading) return;
    setTimerStart(Date.now());
    setTimerNow(Date.now());
    const id = setInterval(() => setTimerNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [loading]);
  const elapsedSec = loading ? ((timerNow - timerStart) / 1000).toFixed(1) : '0.0';

  const runAnalysis = () => {
    if (!filePath) {
      setError('Brak ścieżki pliku');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const req = extraPaths.length > 0
      ? analyzeMergedDropboxFiles([filePath, ...extraPaths])
      : analyzeDropboxFile(filePath);
    req
      .then((d) => {
        setData(d as MergedAnalysisResult);
        playNotificationSound();
        if (extraPaths.length === 0) {
          try {
            const name = d.driver_info?.driver_name || driverName || fileName;
            const url = `/analysis?${new URLSearchParams({ path: filePath, name: fileName, driver: driverName })}`;
            const recent = JSON.parse(localStorage.getItem('recent-analyses') || '[]');
            const filtered = recent.filter((r: any) => r.url !== url);
            filtered.unshift({ name, url });
            localStorage.setItem('recent-analyses', JSON.stringify(filtered.slice(0, 5)));
          } catch {}
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runAnalysis(); }, [filePath, extraPaths]);

  // Discover the driver's other DDD files so a second card can be merged.
  useEffect(() => {
    if (!filePath || otherFiles.length > 0) return;
    fetchDrivers()
      .then((res) => {
        const driver = res.drivers.find((d) =>
          (d.files || []).some((f) => f.path === filePath)
        );
        if (driver) {
          setOtherFiles((driver.files || []).filter((f) => f.path !== filePath));
        }
      })
      .catch(() => {});
  }, [filePath, otherFiles.length]);

  const addMergeFile = (path: string) => {
    if (!path || extraPaths.includes(path)) return;
    setExtraPaths((prev) => [...prev, path]);
  };

  const clearMerge = () => setExtraPaths([]);

  const goBack = () => navigate(-1);

  const availableMergeFiles = otherFiles.filter((f) => !extraPaths.includes(f.path));
  const mergedCount = extraPaths.length > 0 ? extraPaths.length + 1 : 0;

  return (
    <div className="animate-slide-up">
      {/* Breadcrumbs */}
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted">
        <a href="/" className="hover:text-primary-600 transition">Dashboard</a>
        <span>/</span>
        <a href="/drivers" className="hover:text-primary-600 transition">{t('driversTitle')}</a>
        <span>/</span>
        <span className="font-medium text-ink truncate max-w-[200px]">{data?.driver_info?.driver_name || driverName || fileName}</span>
      </nav>

      {/* Header with back button */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <button
          onClick={goBack}
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
        >
          <ArrowLeft size={16} />
          {t('back')}
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {data?.driver_info?.driver_name || driverName || fileName}
          </h1>
          <p className="truncate text-sm text-muted">{fileName}</p>
        </div>
      </div>

      {/* Merge a second card (old + new card in the same month) */}
      {(availableMergeFiles.length > 0 || extraPaths.length > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/50 px-3 py-2 text-sm">
          <Layers size={16} className="text-primary-500" />
          {mergedCount > 0 ? (
            <span className="font-medium text-primary-700 dark:text-primary-400">
              {t('analysisMerged')} ({mergedCount} {locale === 'de' ? 'Karten' : 'kart'}{data?.merged_days ? `, ${data.merged_days} ${locale === 'de' ? 'Tage' : 'dni'}` : ''})
            </span>
          ) : (
            <span className="font-medium text-muted">{t('analysisMergeCard')}:</span>
          )}
          {availableMergeFiles.length > 0 && (
            <select
              value=""
              onChange={(e) => addMergeFile(e.target.value)}
              disabled={loading}
              className="input rounded-lg px-2 py-1 text-xs"
            >
              <option value="">{mergedCount > 0 ? (locale === 'de' ? '+ weitere Karte…' : '+ kolejna karta…') : t('analysisMergeCard') + '…'}</option>
              {availableMergeFiles.map((f) => (
                <option key={f.path} value={f.path}>{fileLabel(f)}</option>
              ))}
            </select>
          )}
          {extraPaths.length > 0 && (
            <button
              onClick={clearMerge}
              disabled={loading}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger transition hover:bg-danger/5"
            >
              <X size={12} />
              {locale === 'de' ? 'Einzelne Karte' : 'Pojedyncza karta'}
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-muted">
            <Spinner size="lg" />
            <p className="text-sm font-medium">{t('analysisLoading')} {elapsedSec}s</p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="py-12">
          <div className="flex flex-col items-center gap-3 text-danger">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
          </div>
        </Card>
      )}

      {/* Result */}
      {!loading && data && !data.error && (
        <Card className="p-3 sm:p-6">
          <AnalysisView
            data={data}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onReanalyze={runAnalysis}
            filePath={filePath}
          />
        </Card>
      )}

      {!loading && data?.error && (
        <Card className="py-12">
          <p className="text-center text-danger">{data.error}</p>
        </Card>
      )}
    </div>
  );
}
