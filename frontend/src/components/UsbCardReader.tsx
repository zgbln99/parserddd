import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Usb, CreditCard, Download, RefreshCw, CloudUpload, Play, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { fetchDrivers, saveReaderFileToDropbox, fetchCardBridgeInfo, type CardBridgeInfo } from '../lib/api';
import {
  bridgeStatus, bridgeRead, bridgeResultToFile, BRIDGE_DOWNLOAD_URL, BRIDGE_README_URL, BRIDGE_EXE_URL,
  type BridgeStatus, type BridgeReadResult,
} from '../lib/cardBridge';
import type { Driver } from '../types';

type Phase = 'checking' | 'offline' | 'online' | 'reading';

/**
 * "USB card reader" panel on the Reader page. Talks to the local LTS Card
 * Bridge: shows whether it runs and whether a card is inserted, downloads
 * the card, matches the driver by card number and saves the .ddd to the
 * cloud folder of that driver. The file can then be analysed in place.
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
      }
      timer = setTimeout(tick, phaseRef.current === 'offline' ? 6000 : 2500);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

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

  return (
    <Card className="mb-4 overflow-hidden p-0" data-animate>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-light text-accent">
          <Usb size={16} />
        </span>
        <h3 className="text-sm font-bold text-ink">{t('usbTitle')}</h3>
        <div className="ml-auto flex items-center gap-2">
          {phase === 'checking' && <Badge variant="gray" dot>{t('loading')}</Badge>}
          {phase === 'offline' && <Badge variant="red" dot>{t('usbOffline')}</Badge>}
          {(phase === 'online' || phase === 'reading') && (
            <>
              <Badge variant="green" dot>{t('usbOnline')} {status?.version ? `v${status.version}` : ''}</Badge>
              {readerName
                ? <Badge variant={cardPresent ? 'blue' : 'gray'} dot>{cardPresent ? t('usbCardPresent') : t('usbNoCard')}</Badge>
                : <Badge variant="orange" dot>{t('usbNoReader')}</Badge>}
            </>
          )}
        </div>
      </div>

      <div className="p-4">
        {phase === 'offline' && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <p className="min-w-0 flex-1 text-sm text-muted">
              {bridgeInfo?.exe_available ? t('usbOfflineHintExe') : t('usbOfflineHint')}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              {bridgeInfo?.exe_available ? (
                <a href={BRIDGE_EXE_URL} className="btn-primary btn-press inline-flex items-center gap-1.5 px-3 py-2 text-xs">
                  <Download size={14} /> {t('usbDownloadExe')}
                </a>
              ) : (
                <a href={BRIDGE_DOWNLOAD_URL} className="btn-primary btn-press inline-flex items-center gap-1.5 px-3 py-2 text-xs">
                  <Download size={14} /> {t('usbDownloadBridge')}
                </a>
              )}
              <a href={BRIDGE_README_URL} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-3 py-2 text-xs">
                <ExternalLink size={14} /> {t('usbInstructions')}
              </a>
            </div>
          </div>
        )}

        {(phase === 'online' || phase === 'reading') && !result && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                {readerName
                  ? <><span className="text-muted">{t('usbReader')}:</span> <span className="font-mono text-xs">{readerName}</span></>
                  : t('usbNoReaderHint')}
              </p>
              {phase === 'reading' && (
                <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <Spinner size="sm" />
                  {t('usbReading')}{progress?.step ? ` · ${progress.step}` : ''}
                </p>
              )}
              {phase === 'online' && !cardPresent && readerName && (
                <p className="mt-1 text-xs text-muted">{t('usbInsertCard')}</p>
              )}
            </div>
            <button
              type="button"
              onClick={readCard}
              disabled={phase === 'reading' || !cardPresent}
              className="btn-primary btn-press inline-flex shrink-0 items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
            >
              {phase === 'reading' ? <Spinner size="sm" /> : <CreditCard size={15} />}
              {t('usbRead')}
            </button>
          </div>
        )}

        {result && file && (
          <div className="space-y-3" data-animate>
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
                <button type="button" onClick={readCard} title={t('usbRead')} className="btn-secondary btn-press inline-flex items-center px-3 py-2 text-sm">
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            {savedPath && <p className="font-mono text-[11px] text-muted">{savedPath}</p>}
          </div>
        )}

        {error && (
          <p className="mt-3 flex items-center gap-2 text-sm text-danger">
            <AlertCircle size={14} /> {error}
          </p>
        )}
      </div>
    </Card>
  );
}
