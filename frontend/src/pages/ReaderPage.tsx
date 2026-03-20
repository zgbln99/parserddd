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
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-ink">{t('readerTitle')}</h1>

      {/* Upload zone */}
      {!result && !loading && (
        <Card
          className={`cursor-pointer border-2 border-dashed transition-all duration-200 ${
            dragging
              ? 'border-primary-400 bg-primary-50/50 dark:border-primary-500 dark:bg-primary-900/10'
              : 'border-border hover:border-primary-300'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-4 py-16">
            <div className={`rounded-2xl bg-primary-50 p-5 transition-transform duration-200 ${dragging ? 'scale-110' : ''}`}>
              <Upload size={32} className="text-primary-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-ink">{t('readerDropHint')}</p>
              <p className="mt-1 text-xs text-muted">{t('readerSelectFile')}</p>
            </div>
            <button className="btn-press mt-1 rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700">
              {t('readerUploadBtn')}
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".ddd" multiple onChange={onFileChange} className="hidden" />
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-muted">
            <Spinner size="lg" />
            <p className="text-sm font-medium">{t('readerAnalyzing')}</p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="py-12">
          <div className="flex flex-col items-center gap-3 text-danger">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => { setError(''); setResult(null); }}
              className="mt-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface"
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
              <p className="truncate text-lg font-semibold text-ink">
                {result.driver_info?.driver_name || result.source_file || t('analysisTitle')}
              </p>
              {result.source_file && result.driver_info?.driver_name && (
                <div className="flex items-center gap-1.5 text-sm text-muted">
                  <FileText size={14} />
                  {result.source_file}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {saved ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <Check size={16} />
                  {t('readerSaved')}
                </span>
              ) : (
                <button
                  onClick={openSaveModal}
                  className="btn-press flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
                >
                  <FolderUp size={14} />
                  {t('readerSaveToDropbox')}
                </button>
              )}
              <button
                onClick={() => { setResult(null); setError(''); setSaved(false); setOriginalFile(null); }}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface"
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
              className="rounded-lg p-2 text-muted transition hover:bg-surface disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            {multiResults.map((fr, i) => (
              <button
                key={i}
                onClick={() => setActiveFileIndex(i)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  i === activeFileIndex
                    ? 'bg-primary-600 text-white'
                    : fr.error
                    ? 'text-danger hover:bg-danger/5'
                    : fr.loading
                    ? 'text-muted'
                    : 'text-ink hover:bg-surface'
                }`}
              >
                {fr.loading ? <Spinner size="sm" /> : null}
                {fr.file.name.replace('.ddd', '')}
                {fr.result && <Check size={12} className="ml-1 inline text-success" />}
                {fr.error && <AlertCircle size={12} className="ml-1 inline text-danger" />}
              </button>
            ))}
            <button
              onClick={() => setActiveFileIndex(Math.min(multiResults.length - 1, activeFileIndex + 1))}
              disabled={activeFileIndex >= multiResults.length - 1}
              className="rounded-lg p-2 text-muted transition hover:bg-surface disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
            <span className="ml-auto text-xs text-muted">
              {activeFileIndex + 1} / {multiResults.length}
            </span>
            <button
              onClick={() => { setMultiResults([]); setResult(null); setError(''); setSaved(false); setOriginalFile(null); }}
              className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface"
            >
              {t('readerUploadBtn')}
            </button>
          </div>

          {/* Active file result */}
          {multiResults[activeFileIndex]?.loading && (
            <Card className="py-16">
              <div className="flex flex-col items-center gap-3 text-muted">
                <Spinner size="lg" />
                <p className="text-sm font-medium">{t('readerAnalyzing')}</p>
              </div>
            </Card>
          )}
          {multiResults[activeFileIndex]?.error && (
            <Card className="py-12">
              <div className="flex flex-col items-center gap-3 text-danger">
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
          <p className="text-sm text-muted">{t('readerSelectDriver')}</p>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={driverSearch}
              onChange={(e) => setDriverSearch(e.target.value)}
              placeholder={t('driversSearch')}
              className="input w-full rounded-xl py-2 pl-9 pr-3 text-sm"
            />
          </div>

          {driversLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
              {filteredDrivers.map((d) => (
                <div
                  key={d.name}
                  onClick={() => setSelectedDriverName(d.name)}
                  className={`cursor-pointer px-4 py-2.5 text-sm transition hover:bg-primary-50 ${
                    selectedDriverName === d.name ? 'bg-primary-50 font-semibold text-primary-700' : 'text-ink'
                  }`}
                >
                  {d.name}
                  {d.card_number && <span className="ml-2 text-xs text-muted">{d.card_number}</span>}
                </div>
              ))}
              {filteredDrivers.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">{t('noData')}</p>
              )}
            </div>
          )}

          {saveError && <p className="text-sm text-danger">{saveError}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowSaveModal(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSaveToDropbox}
              disabled={!selectedDriverName || saving}
              className="btn-press rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? t('loading') : t('readerSaveConfirm')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
