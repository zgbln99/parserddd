import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { analyzeDropboxFile } from '../lib/api';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { AnalysisView } from '../features/AnalysisView';
import { useDateFilter } from '../hooks/useDateFilter';
import type { AnalysisResult } from '../types';

export function AnalysisPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filePath = params.get('path') || '';
  const fileName = params.get('name') || t('analysisTitle');
  const driverName = params.get('driver') || '';
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useDateFilter();

  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const runAnalysis = () => {
    if (!filePath) {
      setError('Brak ścieżki pliku');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    analyzeDropboxFile(filePath)
      .then((d) => {
        setData(d);
        // Save to recent analyses
        try {
          const name = d.driver_info?.driver_name || driverName || fileName;
          const url = `/analysis?${new URLSearchParams({ path: filePath, name: fileName, driver: driverName })}`;
          const recent = JSON.parse(localStorage.getItem('recent-analyses') || '[]');
          const filtered = recent.filter((r: any) => r.url !== url);
          filtered.unshift({ name, url });
          localStorage.setItem('recent-analyses', JSON.stringify(filtered.slice(0, 5)));
        } catch {}
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    runAnalysis();
  }, [filePath]);

  const goBack = () => {
    navigate(-1);
  };

  return (
    <div className="animate-slide-up">
      {/* Header with back button */}
      <div className="mb-6 flex items-center gap-4">
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

      {/* Loading */}
      {loading && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-muted">
            <Spinner size="lg" />
            <p className="text-sm font-medium">{t('analysisLoading')}</p>
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
