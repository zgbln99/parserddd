import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { analyzeUploadedFile } from '../lib/api';
import { Spinner } from '../components/Spinner';
import { Card } from '../components/Card';
import { AnalysisView } from '../features/AnalysisView';
import type { AnalysisResult } from '../types';

export function ReaderPage() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError('');
    setResult(null);
    setDateFrom('');
    setDateTo('');
    try {
      const data = await analyzeUploadedFile(file);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('readerTitle')}</h1>

      {/* Upload zone */}
      {!result && !loading && (
        <Card
          className={`cursor-pointer border-2 border-dashed transition ${
            dragging
              ? 'border-primary-400 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/20'
              : 'border-gray-200 hover:border-primary-300 dark:border-gray-700 dark:hover:border-primary-600'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="rounded-2xl bg-primary-50 p-4 dark:bg-primary-900/20">
              <Upload size={32} className="text-primary-500" />
            </div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('readerDropHint')}</p>
            <p className="text-xs text-gray-400">{t('readerSelectFile')}</p>
            <button className="mt-2 rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 dark:bg-primary-500">
              {t('readerUploadBtn')}
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".ddd" onChange={onFileChange} className="hidden" />
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <Spinner size="lg" />
            <p className="text-sm font-medium">{t('readerAnalyzing')}</p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="py-12">
          <div className="flex flex-col items-center gap-3 text-red-500">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => { setError(''); setResult(null); }}
              className="mt-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium dark:border-gray-700"
            >
              {t('readerUploadBtn')}
            </button>
          </div>
        </Card>
      )}

      {/* Result */}
      {result && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <FileText size={16} />
              {result.source_file || t('analysisTitle')}
            </div>
            <button
              onClick={() => { setResult(null); setError(''); }}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {t('readerUploadBtn')}
            </button>
          </div>
          <Card className="p-6">
            <AnalysisView data={result} dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
          </Card>
        </div>
      )}
    </div>
  );
}
