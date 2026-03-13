import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, FileText, AlertCircle, FolderUp, Check, Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { analyzeUploadedFile, fetchDrivers, saveReaderFileToDropbox } from '../lib/api';
import { Spinner } from '../components/Spinner';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { AnalysisView } from '../features/AnalysisView';
import { useDateFilter } from '../hooks/useDateFilter';
import type { AnalysisResult, Driver } from '../types';

export function ReaderPage() {
  const { t } = useI18n();
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useDateFilter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  // Save to Dropbox state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [selectedDriverName, setSelectedDriverName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const filteredDrivers = useMemo(() => {
    const q = driverSearch.toLowerCase().trim();
    if (!q) return drivers;
    return drivers.filter((d) => d.name.toLowerCase().includes(q));
  }, [drivers, driverSearch]);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError('');
    setResult(null);
    setSaved(false);
    setOriginalFile(file);
    try {
      const data = await analyzeUploadedFile(file);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const openSaveModal = useCallback(() => {
    setShowSaveModal(true);
    setSaveError('');
    setDriverSearch('');
    setSelectedDriverName(result?.driver_info?.driver_name || '');
    if (!drivers.length) {
      setDriversLoading(true);
      fetchDrivers()
        .then((data) => { setDrivers(data.drivers); setDriversLoading(false); })
        .catch(() => setDriversLoading(false));
    }
  }, [result, drivers.length]);

  const handleSaveToDropbox = useCallback(async () => {
    if (!originalFile || !selectedDriverName) return;
    setSaving(true);
    setSaveError('');
    try {
      const cardNumber = result?.driver_info?.card_number || '';
      await saveReaderFileToDropbox(originalFile, selectedDriverName, cardNumber);
      setSaved(true);
      setShowSaveModal(false);
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }, [originalFile, selectedDriverName, result]);

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
            <div className="flex items-center gap-2">
              {saved ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
                  <Check size={16} />
                  {t('readerSaved')}
                </span>
              ) : (
                <button
                  onClick={openSaveModal}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  <FolderUp size={14} />
                  {t('readerSaveToDropbox')}
                </button>
              )}
              <button
                onClick={() => { setResult(null); setError(''); setSaved(false); setOriginalFile(null); }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {t('readerUploadBtn')}
              </button>
            </div>
          </div>
          <Card className="p-6">
            <AnalysisView data={result} dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
          </Card>
        </div>
      )}

      {/* Save to Dropbox modal */}
      <Modal open={showSaveModal} onClose={() => setShowSaveModal(false)} title={t('readerSaveToDropbox')}>
        <div className="space-y-4 p-5">
          <p className="text-sm text-gray-500">{t('readerSelectDriver')}</p>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={driverSearch}
              onChange={(e) => setDriverSearch(e.target.value)}
              placeholder={t('driversSearch')}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:focus:ring-primary-900/40"
            />
          </div>

          {driversLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800">
              {filteredDrivers.map((d) => (
                <div
                  key={d.name}
                  onClick={() => setSelectedDriverName(d.name)}
                  className={`cursor-pointer px-4 py-2.5 text-sm transition hover:bg-blue-50 dark:hover:bg-blue-900/10 ${
                    selectedDriverName === d.name ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' : ''
                  }`}
                >
                  {d.name}
                  {d.card_number && <span className="ml-2 text-xs text-gray-400">{d.card_number}</span>}
                </div>
              ))}
              {filteredDrivers.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-400">{t('noData')}</p>
              )}
            </div>
          )}

          {saveError && <p className="text-sm text-red-500">{saveError}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowSaveModal(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSaveToDropbox}
              disabled={!selectedDriverName || saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? t('loading') : t('readerSaveConfirm')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
