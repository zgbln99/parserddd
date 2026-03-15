import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, FileText, AlertCircle, FolderUp, Check, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n';
import { analyzeUploadedFile, fetchDrivers, saveReaderFileToDropbox } from '../lib/api';
import { Spinner } from '../components/Spinner';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { AnalysisView } from '../features/AnalysisView';
import { useDateFilter } from '../hooks/useDateFilter';
import { useToast } from '../components/Toast';
import type { AnalysisResult, Driver } from '../types';

interface FileResult {
  file: File;
  result: AnalysisResult | null;
  error: string;
  loading: boolean;
}

export function ReaderPage() {
  const { t } = useI18n();
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useDateFilter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  // Multi-file support
  const [multiResults, setMultiResults] = useState<FileResult[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);

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
    setMultiResults([]);
    try {
      const data = await analyzeUploadedFile(file);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMultipleFiles = useCallback(async (files: File[]) => {
    if (files.length === 1) {
      handleFile(files[0]);
      return;
    }
    setResult(null);
    setError('');
    setSaved(false);
    setOriginalFile(null);
    setActiveFileIndex(0);

    const results: FileResult[] = files.map((f) => ({
      file: f,
      result: null,
      error: '',
      loading: true,
    }));
    setMultiResults([...results]);
    setLoading(true);

    for (let i = 0; i < files.length; i++) {
      try {
        const data = await analyzeUploadedFile(files[i]);
        results[i] = { ...results[i], result: data, loading: false };
      } catch (e: any) {
        results[i] = { ...results[i], error: e.message, loading: false };
      }
      setMultiResults([...results]);
    }

    setLoading(false);
    const ok = results.filter((r) => r.result).length;
    const fail = results.filter((r) => r.error).length;
    toast(`${ok} / ${files.length} ${t('files')} OK${fail ? `, ${fail} ${t('error')}` : ''}`, ok === files.length ? 'success' : 'info');
  }, [handleFile, toast, t]);

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
      const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith('.ddd'));
      if (files.length > 1) {
        handleMultipleFiles(files);
      } else if (files[0]) {
        handleFile(files[0]);
      }
    },
    [handleFile, handleMultipleFiles],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 1) {
      handleMultipleFiles(files);
    } else if (files[0]) {
      handleFile(files[0]);
    }
  };

  return (
    <div className="animate-slide-up">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('readerTitle')}</h1>

      {/* Upload zone */}
      {!result && !loading && (
        <Card
          className={`cursor-pointer border-2 border-dashed transition ${
            dragging
              ? 'border-primary-400 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/20'
              : 'border-white/30 hover:border-primary-300 dark:border-white/10 dark:hover:border-primary-600'
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
          <input ref={fileRef} type="file" accept=".ddd" multiple onChange={onFileChange} className="hidden" />
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
          <div className="flex flex-col items-center gap-3 text-rose-500">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => { setError(''); setResult(null); }}
              className="mt-2 rounded-xl border border-white/30 dark:border-white/10 px-4 py-2 text-sm font-medium"
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
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                {result.driver_info?.driver_name || result.source_file || t('analysisTitle')}
              </p>
              {result.source_file && result.driver_info?.driver_name && (
                <div className="flex items-center gap-1.5 text-sm text-gray-500">
                  <FileText size={14} />
                  {result.source_file}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {saved ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <Check size={16} />
                  {t('readerSaved')}
                </span>
              ) : (
                <button
                  onClick={openSaveModal}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110"
                >
                  <FolderUp size={14} />
                  {t('readerSaveToDropbox')}
                </button>
              )}
              <button
                onClick={() => { setResult(null); setError(''); setSaved(false); setOriginalFile(null); }}
                className="rounded-xl border border-white/30 dark:border-white/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03] dark:hover:bg-white/5"
              >
                {t('readerUploadBtn')}
              </button>
            </div>
          </div>
          <Card className="p-3 sm:p-6">
            <AnalysisView data={result} dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
          </Card>
        </div>
      )}

      {/* Multi-file results */}
      {multiResults.length > 1 && (
        <div>
          {/* File selector tabs */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveFileIndex(Math.max(0, activeFileIndex - 1))}
              disabled={activeFileIndex === 0}
              className="rounded-lg p-2 text-gray-500 transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
            >
              <ChevronLeft size={16} />
            </button>
            {multiResults.map((fr, i) => (
              <button
                key={i}
                onClick={() => setActiveFileIndex(i)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  i === activeFileIndex
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                    : fr.error
                    ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10'
                    : fr.loading
                    ? 'text-gray-400'
                    : 'text-gray-600 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5'
                }`}
              >
                {fr.loading ? <Spinner size="sm" /> : null}
                {fr.file.name.replace('.ddd', '')}
                {fr.result && <Check size={12} className="ml-1 inline text-emerald-500" />}
                {fr.error && <AlertCircle size={12} className="ml-1 inline text-rose-500" />}
              </button>
            ))}
            <button
              onClick={() => setActiveFileIndex(Math.min(multiResults.length - 1, activeFileIndex + 1))}
              disabled={activeFileIndex >= multiResults.length - 1}
              className="rounded-lg p-2 text-gray-500 transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
            >
              <ChevronRight size={16} />
            </button>
            <span className="ml-auto text-xs text-gray-400">
              {activeFileIndex + 1} / {multiResults.length}
            </span>
            <button
              onClick={() => { setMultiResults([]); setResult(null); setError(''); setSaved(false); setOriginalFile(null); }}
              className="rounded-xl border border-white/30 dark:border-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/[0.03] dark:hover:bg-white/5"
            >
              {t('readerUploadBtn')}
            </button>
          </div>

          {/* Active file result */}
          {multiResults[activeFileIndex]?.loading && (
            <Card className="py-16">
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <Spinner size="lg" />
                <p className="text-sm font-medium">{t('readerAnalyzing')}</p>
              </div>
            </Card>
          )}
          {multiResults[activeFileIndex]?.error && (
            <Card className="py-12">
              <div className="flex flex-col items-center gap-3 text-rose-500">
                <AlertCircle size={32} />
                <p className="text-sm">{multiResults[activeFileIndex].error}</p>
              </div>
            </Card>
          )}
          {multiResults[activeFileIndex]?.result && (
            <Card className="p-3 sm:p-6">
              <AnalysisView
                data={multiResults[activeFileIndex].result!}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
              />
            </Card>
          )}
        </div>
      )}

      {/* Save to Dropbox modal */}
      <Modal open={showSaveModal} onClose={() => setShowSaveModal(false)} title={t('readerSaveToDropbox')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{t('readerSelectDriver')}</p>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={driverSearch}
              onChange={(e) => setDriverSearch(e.target.value)}
              placeholder={t('driversSearch')}
              className="glass-input w-full rounded-xl py-2 pl-9 pr-3 text-sm outline-none"
            />
          </div>

          {driversLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-white/20 dark:border-white/5">
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

          {saveError && <p className="text-sm text-rose-500">{saveError}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowSaveModal(false)}
              className="rounded-lg border border-white/30 dark:border-white/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03] dark:hover:bg-white/5"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSaveToDropbox}
              disabled={!selectedDriverName || saving}
              className="rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t('loading') : t('readerSaveConfirm')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
