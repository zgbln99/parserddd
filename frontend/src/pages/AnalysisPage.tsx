import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { analyzeDropboxFile } from '../lib/api';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { AnalysisView } from '../features/AnalysisView';
import type { AnalysisResult } from '../types';

export function AnalysisPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filePath = params.get('path') || '';
  const fileName = params.get('name') || t('analysisTitle');
  const driverName = params.get('driver') || '';

  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filePath]);

  const goBack = () => {
    navigate(-1);
  };

  return (
    <div>
      {/* Header with back button */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={goBack}
          className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <ArrowLeft size={16} />
          {t('back')}
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{fileName}</h1>
          {driverName && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{driverName}</p>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <Spinner size="lg" />
            <p className="text-sm font-medium">{t('analysisLoading')}</p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="py-12">
          <div className="flex flex-col items-center gap-3 text-red-500">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
          </div>
        </Card>
      )}

      {/* Result */}
      {!loading && data && !data.error && (
        <Card className="p-6">
          <AnalysisView
            data={data}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        </Card>
      )}

      {!loading && data?.error && (
        <Card className="py-12">
          <p className="text-center text-red-500">{data.error}</p>
        </Card>
      )}
    </div>
  );
}
