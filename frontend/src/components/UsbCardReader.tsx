import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Usb, CreditCard, Download, CloudUpload, Play, CheckCircle, AlertCircle, ExternalLink, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { fetchDrivers, saveReaderFileToDropbox, fetchCardBridgeInfo, type CardBridgeInfo } from '../lib/api';
import {
  bridgeStatus, bridgeRead, bridgeResultToFile, BRIDGE_DOWNLOAD_URL, BRIDGE_README_URL, BRIDGE_EXE_URL,
  type BridgeStatus, type BridgeReadResult,
} from '../lib/cardBridge';
import type { Driver } from '../types';

type Phase = 'checking' | 'offline' | 'online' | 'reading';

export const USB_RESULT_SLOT_ID = 'usb-result-slot';

/**
 * USB card reader on the Reader page, kept small: a status chip in the page
 * header ("connected" / "not connected"), the "read card" button when a card
 * is inserted, and a popover with the bridge download behind the chip. The
 * result of a download renders into the `#usb-result-slot` element the page
 * places above the upload zone. Talks to the local LTS Card Bridge.
 */
export function UsbCardReader({ onAnalyze }: { onAnalyze: (file: File) => void }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('checking');
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [result, setResult] = useState<BridgeReadResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverName, setDriverName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [bridgeInfo, setBridgeInfo] = useState<CardBridgeInfo | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const wasOnline = useRef<boolean | null>(null);
  const phaseRef = useRef<Phase>('checking');
  phaseRef.current = phase;

  // Poll the bridge: quickly while it is up (card in/out), slowly while down.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const tick = async () => {
      if (phaseRef.current !== 'reading') {
        const s = await bridgeStatus();
        if (cancelled) return;
        setStatus(s);
        setPhase(s ? 'online' : 'offline');
        const online = Boolean(s);
        if (wasOnline.current !== null && wasOnline.current !== online) {
          toast(online ? t('usbConnectedToast') : t('usbDisconnectedToast'), online ? 'success' : 'error');
        }
        wasOnline.current = online;
      }
      timer = setTimeout(tick, phaseRef.current === 'offline' ? 6000 : 2500);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const onClick = (e: MouseEvent) => { if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [helpOpen]);

  useEffect(() => {
    fetchDrivers().then((r) => setDrivers(r.drivers || [])).catch(() => {});
    fetchCardBridgeInfo().then(setBridgeInfo).catch(() => {});
  }, []);

  const matchedDriver = useMemo(() => {
    const card = result?.identification.card_number || '';
    if (!card) return null;
    return drivers.find((d) => d.card_number === card)
      || drivers.find((d) => d.files.some((f) => f.name.startsWith(card)))
      || null;
  }, [drivers, result]);

  const holderName = useMemo(() => {
    const id = result?.identification;
    if (!id) return '';
    return `${id.first_names || ''} ${id.surname || ''}`.trim();
  }, [result]);

  useEffect(() => {
    if (!result) return;
    setDriverName(matchedDriver?.name || holderName);
  }, [result, matchedDriver, holderName]);

  const readCard = useCallback(async () => {
    setError('');
    setResult(null);
    setFile(null);
    setSavedPath('');
    setPhase('reading');
    try {
      const r = await bridgeRead();
      setResult(r);
      setFile(bridgeResultToFile(r));
      toast(t('usbReadDone'), 'success');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setPhase('online');
    }
  }, [t, toast]);

  const save = useCallback(async () => {
    if (!file || !driverName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await saveReaderFileToDropbox(file, driverName.trim(), result?.identification.card_number || '');
      setSavedPath(res.path);
      toast(t('usbSaved'), 'success');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [file, driverName, result, t, toast]);

  const readerName = status?.readers?.[0]?.name || '';
  const cardPresent = Boolean(status?.card_present);
  const progress = status?.progress;
  const online = phase === 'online' || phase === 'reading';

  const chipTitle = online
    ? (readerName ? `${readerName} · ${cardPresent ? t('usbCardPresent') : t('usbNoCard')}` : t('usbNoReaderHint'))
    : t('usbOfflineShort');

  const resultPanel = result && file && (
    <Card className="mb-4 p-4" data-animate>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t('usbHolder')}</p>
            <p className="truncate text-sm font-semibold text-ink">{holderName || '—'}</p>
          </div>
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t('usbCard')}</p>
            <p className="truncate font-mono text-sm text-ink">{result.identification.card_number || '—'}</p>
          </div>
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t('usbFile')}</p>
            <p className="truncate font-mono text-xs text-ink">{result.filename} · {(result.size / 1024).toFixed(1)} KB · Gen{result.generation}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-semibold text-muted">
            {t('usbSaveAs')}
            <input
              id="usb-driver-name"
              list="usb-driver-names"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              className="input mt-1 w-full rounded-lg px-3 py-2 text-sm font-medium text-ink"
            />
            <datalist id="usb-driver-names">
              {drivers.map((d) => <option key={d.name} value={d.name} />)}
            </datalist>
            <span className="mt-1 block text-[11px] font-normal text-muted">
              {matchedDriver
                ? (locale === 'de' ? `Fahrer anhand der Kartennummer erkannt: ${matchedDriver.name}` : `Kierowca rozpoznany po numerze karty: ${matchedDriver.name}`)
                : t('usbNewDriver')}
            </span>
          </label>
          <div className="flex shrink-0 gap-2">
            {!savedPath ? (
              <button type="button" onClick={save} disabled={saving || !driverName.trim()} className="btn-primary btn-press inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50">
                {saving ? <Spinner size="sm" /> : <CloudUpload size={15} />}
                {t('usbSave')}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-2 text-xs font-bold text-success">
                <CheckCircle size={14} /> {t('usbSaved')}
              </span>
            )}
            <button type="button" onClick={() => onAnalyze(file)} className="btn-secondary btn-press inline-flex items-center gap-2 px-4 py-2 text-sm">
              <Play size={14} /> {t('usbAnalyze')}
            </button>
            <button type="button" onClick={() => { setResult(null); setFile(null); setSavedPath(''); }} title={t('close')} className="btn-secondary btn-press inline-flex items-center px-3 py-2 text-sm">
              <X size={14} />
            </button>
          </div>
        </div>
        {savedPath && <p className="font-mono text-[11px] text-muted">{savedPath}</p>}
        {error && (
          <p className="flex items-center gap-2 text-sm text-danger"><AlertCircle size={14} /> {error}</p>
        )}
      </div>
    </Card>
  );
  const slot = typeof document !== 'undefined' ? document.getElementById(USB_RESULT_SLOT_ID) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status chip; click opens the small help popover */}
      <div ref={helpRef} className="relative">
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          title={chipTitle}
          aria-expanded={helpOpen}
          className={clsx(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition',
            phase === 'checking' && 'border-border bg-surface-2 text-muted',
            phase === 'offline' && 'border-border bg-surface-2 text-muted hover:text-ink',
            online && (cardPresent ? 'border-success/30 bg-success-soft text-success' : 'border-border bg-card text-ink'),
          )}
        >
          <span className={clsx('h-1.5 w-1.5 rounded-full', phase === 'checking' ? 'bg-muted' : online ? 'bg-success' : 'bg-danger')} />
          <Usb size={13} />
          {phase === 'checking' ? t('loading') : online ? t('usbConnected') : t('usbDisconnected')}
        </button>

        {helpOpen && (
          <div className="card absolute right-0 top-10 z-40 w-[min(92vw,360px)] p-3 text-sm shadow-[var(--shadow-3)]">
            {online ? (
              <>
                <p className="text-xs text-muted">{t('usbReader')}: <span className="font-mono text-ink">{readerName || '—'}</span></p>
                <p className="mt-1 text-xs text-muted">{readerName ? (cardPresent ? t('usbCardPresent') : t('usbInsertCard')) : t('usbNoReaderHint')}</p>
                <p className="mt-1 text-[11px] text-muted">LTS Card Bridge v{status?.version}</p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted">{bridgeInfo?.exe_available ? t('usbOfflineHintExe') : t('usbOfflineHint')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {bridgeInfo?.exe_available ? (
                    <a href={BRIDGE_EXE_URL} className="btn-primary btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                      <Download size={13} /> {t('usbDownloadExe')}
                    </a>
                  ) : (
                    <a href={BRIDGE_DOWNLOAD_URL} className="btn-primary btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                      <Download size={13} /> {t('usbDownloadBridge')}
                    </a>
                  )}
                  <a href={BRIDGE_README_URL} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                    <ExternalLink size={13} /> {t('usbInstructions')}
                  </a>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Read button: only when the bridge sees a card */}
      {online && (cardPresent || phase === 'reading') && (
        <button
          type="button"
          onClick={readCard}
          disabled={phase === 'reading'}
          className="btn-primary btn-press inline-flex h-8 items-center gap-2 px-3 text-xs disabled:opacity-60"
        >
          {phase === 'reading' ? <Spinner size="sm" /> : <CreditCard size={14} />}
          {phase === 'reading' ? `${t('usbReading')}${progress?.step ? ` · ${progress.step}` : ''}` : t('usbRead')}
        </button>
      )}
      {!result && error && (
        <span className="flex items-center gap-1 text-xs text-danger"><AlertCircle size={13} /> {error}</span>
      )}

      {slot && resultPanel ? createPortal(resultPanel, slot) : null}
    </div>
  );
}
