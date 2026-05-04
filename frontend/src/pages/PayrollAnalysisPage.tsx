import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertCircle, CheckSquare, FileText, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { analyzeDropboxFile, setPayrollStatus, type PayrollStatusValue } from '../lib/api';
import { Spinner } from '../components/Spinner';
import type { AnalysisResult } from '../types';

const AnalysisView = lazy(() => import('../features/AnalysisView').then(m => ({ default: m.AnalysisView })));

export function PayrollAnalysisPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { card } = useParams();

  const period = params.get('period') || '';
  const filePath = params.get('path') || '';
  const driverName = params.get('name') || '';
  const fileDate = params.get('fileDate') || '';
  const fileModified = params.get('fileModified') || '';

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
  const [showBackDialog, setShowBackDialog] = useState(false);

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

  const cardNumber = card || '';

  const handleMarkAndBack = useCallback(async (status: PayrollStatusValue) => {
    if (period && cardNumber) {
      try {
        await setPayrollStatus(period, cardNumber, status);
      } catch { /* best effort */ }
    }
    navigate(-1);
  }, [period, cardNumber, navigate]);

  const handleBack = () => setShowBackDialog(true);

  return (
    <div className="animate-slide-up">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted transition hover:text-ink hover:border-primary-300"
        >
          <ArrowLeft size={16} />
          {t('back')}
        </button>
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {t('payrollAnalyze')}: {driverName}
          </h1>
          <div className="flex items-center gap-3 mt-0.5 text-sm text-muted">
            {period && <span>{period}</span>}
            {fileDate && (
              <>
                <span className="text-border">|</span>
                <span>{t('payrollFileDate')}: <strong className="text-ink">{fileDate}</strong></span>
              </>
            )}
            {fileModified && (
              <>
                <span className="text-border">|</span>
                <span>{t('payrollLastDownload')}: <strong className="text-ink">{new Date(fileModified).toLocaleDateString('de-DE')} {new Date(fileModified).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</strong></span>
              </>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-3 py-20">
          <Spinner />
          <p className="text-sm text-muted">{t('loading')}</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {data && !loading && (
        <Suspense fallback={<Spinner />}>
          <AnalysisView
            data={data}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            filePath={filePath}
            vacationRanges={vacationRanges}
          />
        </Suspense>
      )}

      {/* Back confirmation dialog */}
      {showBackDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 animate-fade-in" onClick={() => setShowBackDialog(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#272729] p-6 mx-4 animate-scale-in" style={{ boxShadow: 'rgba(0,0,0,0.15) 0px 8px 40px' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-ink mb-1">
              {locale === 'de' ? 'Status setzen?' : 'Ustawić status?'}
            </h3>
            <p className="text-sm text-muted mb-5">
              {locale === 'de'
                ? `${driverName} — Wie soll der Status markiert werden?`
                : `${driverName} — Jak oznaczyć status?`}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleMarkAndBack('policzony')}
                className="flex items-center gap-3 rounded-xl bg-[#30d158]/10 px-4 py-3 text-sm font-medium text-[#248a3d] dark:text-[#30d158] transition hover:bg-[#30d158]/20"
              >
                <CheckSquare size={18} />
                {locale === 'de' ? 'Als geprüft markieren' : 'Oznacz jako policzony'}
              </button>
              <button
                onClick={() => handleMarkAndBack('stundenzettel')}
                className="flex items-center gap-3 rounded-xl bg-[#0071e3]/10 px-4 py-3 text-sm font-medium text-[#0071e3] transition hover:bg-[#0071e3]/20"
              >
                <FileText size={18} />
                Stundenzettel
              </button>
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-3 rounded-xl bg-[#f5f5f7] dark:bg-white/5 px-4 py-3 text-sm font-medium text-muted transition hover:bg-gray-200 dark:hover:bg-white/10"
              >
                <X size={18} />
                {locale === 'de' ? 'Ohne Änderung zurück' : 'Wróć bez zmiany'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
