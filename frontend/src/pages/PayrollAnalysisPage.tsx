import { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { analyzeDropboxFile } from '../lib/api';
import { Spinner } from '../components/Spinner';
import type { AnalysisResult } from '../types';

const AnalysisView = lazy(() => import('../features/AnalysisView').then(m => ({ default: m.AnalysisView })));

export function PayrollAnalysisPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const period = params.get('period') || '';
  const filePath = params.get('path') || '';
  const driverName = params.get('name') || '';

  // Parse vacation ranges from URL
  const vacationRanges: { von: string; bis: string; tage: number }[] = (() => {
    try {
      const raw = params.get('vacation');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
  })();

  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState(`${period}-01`);
  const [dateTo, setDateTo] = useState(`${period}-31`);

  useEffect(() => {
    if (!filePath) {
      setError('Brak ścieżki pliku');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    analyzeDropboxFile(filePath)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [filePath]);

  return (
    <div className="animate-slide-up">
      {/* Header with back button */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted transition hover:text-ink hover:border-primary-300"
        >
          <ArrowLeft size={16} />
          {t('back')}
        </button>
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {t('payrollAnalyze')}: {driverName}
          </h1>
          {period && (
            <p className="text-sm text-muted mt-0.5">
              {period}
            </p>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-20">
          <Spinner />
          <p className="text-sm text-muted">{t('loading')}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Analysis */}
      {data && !loading && (
        <Suspense fallback={<Spinner />}>
          <AnalysisView
            data={data}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            vacationRanges={vacationRanges}
          />
        </Suspense>
      )}
    </div>
  );
}
