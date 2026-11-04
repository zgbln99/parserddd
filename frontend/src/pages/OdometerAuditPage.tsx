import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck, RefreshCw, Upload, FileDown, Search, ChevronDown, ChevronRight, AlertTriangle,
  CheckCircle2, CircleDot, XCircle, Files, Gauge, Truck, IdCard, Clock, Info,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { matchesText } from '../lib/text';
import {
  fetchAuditSummary, startAuditScan, cancelAuditScan, fetchAuditScanStatus, fetchAuditReport, fetchAuditVehicle,
  uploadAuditFiles, type AuditSummary, type AuditScanStatus, type AuditReport, type AuditRow, type AuditTimeline,
} from '../lib/api';

/**
 * Year-end odometer audit. The fleet has no vehicle-unit downloads, so the
 * km-stand of each vehicle on 31.12 is reconstructed from the driver cards:
 * every card records the vehicle's odometer at insertion and withdrawal.
 * The page drives the background scan of the card archive, shows the
 * per-vehicle result for a chosen year and exports it to Excel.
 */

function fmtKm(n: number | null | undefined): string {
  return n == null ? '–' : Math.round(n).toLocaleString('de-DE');
}

function fmtTs(iso: string, withTime = true): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return withTime
    ? d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const QUALITY_VARIANT = { exact: 'green', ok: 'blue', gap: 'orange' } as const;

export function OdometerAuditPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();

  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [scan, setScan] = useState<AuditScanStatus | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear() - 1);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Record<string, AuditTimeline | 'loading'>>({});
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadSummary = useCallback(async () => {
    try {
      const s = await fetchAuditSummary();
      setSummary(s);
      setScan(s.scan);
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const loadReport = useCallback(async (y: number) => {
    setLoading(true);
    setError('');
    try {
      setReport(await fetchAuditReport(y));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary().then((s) => {
      if (s && s.years.length && !s.years.includes(year)) setYear(s.years[s.years.length - 1]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadReport(year); setExpanded(null); setTimeline({}); }, [year, loadReport]);

  // Poll the scan while it runs; refresh everything when it ends.
  useEffect(() => {
    if (!scan?.running) return;
    const id = setInterval(async () => {
      try {
        const st = await fetchAuditScanStatus();
        setScan(st);
        if (!st.running) {
          clearInterval(id);
          toast(`${t('oaScanDone')}: ${st.done} · ${st.new_records} ${t('oaNewRecords')}`, st.error_count ? 'info' : 'success');
          await loadSummary();
          await loadReport(year);
        }
      } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(id);
  }, [scan?.running, loadSummary, loadReport, year, t, toast]);

  const runScan = async (force = false) => {
    try {
      const r = await startAuditScan(force);
      setScan(r.status);
      if (!r.started) toast(t('oaScanning'), 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.ddd$/i.test(f.name));
    if (!list.length) return;
    setUploading(true);
    try {
      const r = await uploadAuditFiles(list);
      const bad = r.results.filter((x) => x.error);
      toast(`${t('oaUploaded')}: ${r.results.length} · ${r.new_records} ${t('oaNewRecords')}${bad.length ? ` · ${bad.length} ✗` : ''}`, bad.length ? 'info' : 'success');
      await loadSummary();
      await loadReport(year);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setUploading(false);
    }
  };

  const toggleRow = async (row: AuditRow) => {
    const key = row.plate_norm;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!timeline[key]) {
      setTimeline((m) => ({ ...m, [key]: 'loading' }));
      try {
        const tl = await fetchAuditVehicle(key, year);
        setTimeline((m) => ({ ...m, [key]: tl }));
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
        setTimeline((m) => { const c = { ...m }; delete c[key]; return c; });
      }
    }
  };

  const rows = useMemo(() => {
    if (!report) return [];
    let list = report.rows;
    if (onlyActive) list = list.filter((r) => r.active_in_year);
    if (query.trim()) list = list.filter((r) => matchesText(r.plate, query) || matchesText(r.plate_norm, query) || matchesText(r.driver, query));
    return list;
  }, [report, onlyActive, query]);

  const exportXlsx = async () => {
    if (!report) return;
    const XLSX = await import('xlsx-js-style');
    const de = locale === 'de';
    const headers = de
      ? ['Kennzeichen', `Km-Stand 31.12.${year}`, 'Datum des Eintrags', 'Quelle', 'Fahrer', 'Kartennummer', 'Abstand (Tage)', 'Qualität',
         'Letzter Eintrag davor (km)', 'Datum', 'Erster Eintrag danach (km)', 'Datum', 'Km zwischen', `Km-Stand 31.12.${year - 1}`, 'Km im Jahr', 'Einträge im Jahr', 'Fahrer im Jahr', 'VIN']
      : ['Rejestracja', `Stan km 31.12.${year}`, 'Data wpisu', 'Źródło', 'Kierowca', 'Nr karty', 'Odstęp (dni)', 'Jakość',
         'Ostatni wpis przed (km)', 'Data', 'Pierwszy wpis po (km)', 'Data', 'Km między', `Stan km 31.12.${year - 1}`, 'Km w roku', 'Wpisy w roku', 'Kierowcy w roku', 'VIN'];
    const q = { exact: t('oaQualityExact'), ok: t('oaQualityOk'), gap: t('oaQualityGap') };
    const data: (string | number | null)[][] = rows.map((r) => [
      r.plate, r.km, fmtTs(r.at), r.source === 'before' ? t('oaSourceBefore') : t('oaSourceAfter'), r.driver, r.card_number,
      r.gap_days, q[r.quality], r.before_km, r.before_at ? fmtTs(r.before_at) : '', r.after_km, r.after_at ? fmtTs(r.after_at) : '',
      r.bracket_km, r.km_prev_year, r.km_in_year, r.records_in_year, r.drivers_in_year, r.vin,
    ]);
    const title = de ? `Kilometerstand zum Jahresende ${year} (aus Fahrerkartendateien)` : `Stan licznika na koniec roku ${year} (z plików kart kierowców)`;
    const ws = XLSX.utils.aoa_to_sheet([[title], [t('oaCutoffNote')], [], headers, ...data]);
    const headerStyle = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: 'E8EEF4' } }, border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } };
    headers.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r: 3, c });
      if (ws[addr]) ws[addr].s = headerStyle;
    });
    ws['A1'].s = { font: { bold: true, sz: 13 } };
    ws['!cols'] = [16, 16, 18, 34, 24, 18, 12, 10, 16, 18, 16, 18, 12, 16, 12, 12, 12, 20].map((wch) => ({ wch }));
    ws['!freeze'] = { xSplit: 1, ySplit: 4 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${year}`);
    XLSX.writeFile(wb, `${de ? 'Km-Stand' : 'Stan-km'}_31-12-${year}.xlsx`);
  };

  const years = summary?.years?.length ? summary.years : [year];
  const progressPct = scan && scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : 0;

  return (
    <div className="animate-slide-up space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
            <CalendarCheck size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{t('oaTitle')}</h1>
            <p className="text-xs text-muted">{t('oaSubtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            {t('oaYear')}
            <select id="oa-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="input rounded-lg px-3 py-1.5 text-sm font-semibold text-ink outline-none">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button type="button" onClick={exportXlsx} disabled={!rows.length} className="btn-secondary btn-press inline-flex items-center gap-2 px-3 py-1.5 text-sm disabled:opacity-50">
            <FileDown size={15} /> {t('oaExport')}
          </button>
        </div>
      </div>

      {/* Data source: scan + upload */}
      <Card className="p-4" data-animate>
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div>
            <p className="text-sm text-muted">{t('oaIntro')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {scan?.running ? (
                <button type="button" onClick={() => cancelAuditScan()} className="btn-secondary btn-press inline-flex items-center gap-2 px-3 py-2 text-sm">
                  <XCircle size={15} /> {t('oaCancel')}
                </button>
              ) : (
                <>
                  <button type="button" id="oa-scan" onClick={() => runScan(false)} className="btn-primary btn-press inline-flex items-center gap-2 px-3.5 py-2 text-sm">
                    <RefreshCw size={15} /> {t('oaScan')}
                  </button>
                  <button type="button" onClick={() => runScan(true)} className="btn-secondary btn-press inline-flex items-center gap-2 px-3 py-2 text-sm">
                    {t('oaRescanAll')}
                  </button>
                </>
              )}
              <span className="text-[11px] text-muted">
                {summary?.last_scan ? `${t('oaLastScan')}: ${fmtTs(summary.last_scan)}` : ''}
              </span>
            </div>
            {scan && (scan.running || scan.finished_at) && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span className={clsx('inline-flex items-center gap-1.5', scan.message.startsWith('failed') && 'text-danger')}>
                    {scan.running ? <Spinner size="sm" /> : scan.message.startsWith('failed') ? <XCircle size={12} /> : <CheckCircle2 size={12} className="text-success" />}
                    {scan.running ? t('oaScanning') : scan.message.startsWith('failed') ? scan.message : t('oaScanDone')} · {scan.done}/{scan.total}
                    {scan.skipped ? ` · ${scan.skipped} ${t('oaSkipped')}` : ''} · {scan.new_records} {t('oaNewRecords')}
                    {scan.error_count ? ` · ${scan.error_count} ✗` : ''}
                  </span>
                  <span className="font-mono tabular-nums">{progressPct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${scan.running ? progressPct : 100}%` }} />
                </div>
                {scan.running && scan.current && <p className="mt-1 truncate font-mono text-[10px] text-muted">{scan.current}</p>}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files); }}
            className={clsx(
              'flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-4 text-center text-xs text-muted transition',
              dragOver ? 'border-accent bg-accent-light' : 'border-border hover:border-accent/50 hover:bg-surface-2',
            )}
          >
            {uploading ? <Spinner /> : <Upload size={20} className="text-accent" />}
            <span className="font-semibold text-ink">{t('oaUpload')}</span>
            <span>{t('oaUploadHint')}</span>
            <input ref={fileInput} type="file" accept=".ddd,.DDD" multiple className="hidden" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }} />
          </button>
        </div>
      </Card>

      {/* KPIs */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-animate>
          {[
            { icon: Files, label: t('oaFilesScanned'), value: summary.files, sub: summary.files_with_errors ? `${summary.files_with_errors} ✗` : '' },
            { icon: IdCard, label: t('oaCards'), value: summary.cards, sub: '' },
            { icon: Gauge, label: t('oaRecords'), value: summary.records, sub: '' },
            { icon: Truck, label: t('oaVehicles'), value: summary.plates, sub: '' },
            { icon: Clock, label: `${t('oaYear')} ${year}`, value: report?.counts.active ?? 0, sub: report ? `${report.counts.exact} ${t('oaQualityExact')} · ${report.counts.ok} ${t('oaQualityOk')} · ${report.counts.gap} ${t('oaQualityGap')}` : '' },
          ].map(({ icon: Icon, label, value, sub }) => (
            <div key={label} className="card kpi kpi-accent px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Icon size={12} /> {label}</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">{value.toLocaleString('de-DE')}</p>
              {sub && <p className="text-[11px] text-muted">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Report */}
      <Card className="overflow-hidden" data-animate>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input id="oa-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('oaSearchPlate')} className="input w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none" />
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            {t('oaOnlyActive')}
          </label>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted" title={t('oaQualityHint')}>
            <Info size={12} /> {t('oaCutoffNote')}
          </span>
        </div>

        {loading && !report ? (
          <div className="flex justify-center p-10"><Spinner /></div>
        ) : error ? (
          <p className="flex items-center gap-2 p-5 text-sm text-danger"><AlertTriangle size={15} /> {error}</p>
        ) : !rows.length ? (
          <p className="p-6 text-sm text-muted">{summary && summary.records === 0 ? t('oaNoData') : '—'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/60">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="w-8 px-2 py-2.5" />
                  <th className="px-3 py-2.5">{t('oaColPlate')}</th>
                  <th className="px-3 py-2.5 text-right">{t('oaColKm')}</th>
                  <th className="px-3 py-2.5">{t('oaColAt')}</th>
                  <th className="px-3 py-2.5">{t('oaColStatus')}</th>
                  <th className="px-3 py-2.5">{t('oaColDriver')}</th>
                  <th className="px-3 py-2.5 text-right">{t('oaColBefore')}</th>
                  <th className="px-3 py-2.5 text-right">{t('oaColAfter')}</th>
                  <th className="px-3 py-2.5 text-right">{t('oaColBracket')}</th>
                  <th className="px-3 py-2.5 text-right">{t('oaColKmYear')}</th>
                  <th className="px-3 py-2.5 text-right">{t('oaColRecords')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const open = expanded === r.plate_norm;
                  const tl = timeline[r.plate_norm];
                  return (
                    <Fragment key={r.plate_norm}>
                      <tr onClick={() => toggleRow(r)} className={clsx('cursor-pointer transition hover:bg-surface-2/70', open && 'bg-accent-light/60')}>
                        <td className="px-2 py-2.5 text-muted">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-ink">
                          {r.plate}
                          {!r.active_in_year && <span className="ml-1.5 text-[10px] font-normal text-muted">({t('oaQualityGap')})</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-base font-bold tabular-nums text-ink">{fmtKm(r.km)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums" title={r.source === 'before' ? t('oaSourceBefore') : t('oaSourceAfter')}>
                          {fmtTs(r.at)}
                          <span className="ml-1 text-[10px] text-muted">{r.source === 'before' ? '◄' : '►'}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <Badge variant={QUALITY_VARIANT[r.quality]} dot>
                            {t(r.quality === 'exact' ? 'oaQualityExact' : r.quality === 'ok' ? 'oaQualityOk' : 'oaQualityGap')}
                            {r.gap_days != null ? ` · ${r.gap_days} ${t('oaDays')}` : ''}
                          </Badge>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 text-xs" title={r.card_number}>{r.driver || r.card_number}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
                          {r.before_km != null ? <>{fmtKm(r.before_km)}<br /><span className="text-[10px]">{fmtTs(r.before_at, false)}</span></> : '–'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
                          {r.after_km != null ? <>{fmtKm(r.after_km)}<br /><span className="text-[10px]">{fmtTs(r.after_at, false)}</span></> : '–'}
                        </td>
                        <td className={clsx('whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums', (r.bracket_km ?? 0) > 2000 ? 'text-warning' : 'text-muted')}>
                          {r.bracket_km != null ? `${fmtKm(r.bracket_km)}${r.bracket_days != null ? ` / ${r.bracket_days} d` : ''}` : '–'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmtKm(r.km_in_year)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted">{r.records_in_year}{r.drivers_in_year ? ` / ${r.drivers_in_year}` : ''}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={11} className="bg-surface-2/40 px-4 py-3">
                            {!tl || tl === 'loading' ? (
                              <div className="flex justify-center py-3"><Spinner size="sm" /></div>
                            ) : (
                              <TimelineView tl={tl} cutoff={report?.cutoff || ''} t={t} />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {summary && summary.errors.length > 0 && (
        <Card className="p-4" data-animate>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><AlertTriangle size={14} className="text-warning" /> {t('oaErrors')} ({summary.files_with_errors})</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-muted">
            {summary.errors.map((e) => <li key={e.path} className="truncate">{e.path} — {e.error}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function TimelineView({ tl, cutoff, t }: { tl: AuditTimeline; cutoff: string; t: (k: any) => string }) {
  const before = tl.records.filter((r) => r.last_use <= cutoff);
  const after = tl.records.filter((r) => r.last_use > cutoff);
  const render = (list: typeof tl.records, highlightLast: boolean) => list.map((r, i) => {
    const isPick = highlightLast ? i === list.length - 1 : i === 0;
    return (
      <tr key={`${r.card_number}-${r.first_use}`} className={clsx(isPick && 'bg-success-soft font-semibold')}>
        <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] tabular-nums">{fmtTs(r.first_use)}</td>
        <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] tabular-nums">{fmtTs(r.last_use)}</td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-[11px] tabular-nums">{fmtKm(r.odo_begin)}</td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-[11px] tabular-nums">{fmtKm(r.odo_end)}</td>
        <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-[11px] tabular-nums text-muted">{fmtKm(r.odo_end - r.odo_begin)}</td>
        <td className="truncate px-2 py-1 text-[11px]" title={r.card_number}>{r.driver || r.card_number}</td>
        <td className="px-2 py-1 font-mono text-[11px] text-muted">{r.plate}</td>
        <td className="px-2 py-1">{isPick && <CircleDot size={12} className="text-success" />}</td>
      </tr>
    );
  });
  return (
    <div>
      <p className="mb-2 text-xs text-muted">
        <span className="font-semibold text-ink">{t('oaTimeline')}</span> · {tl.total_records} {t('oaTotalRecords')} · {tl.drivers} {t('oaDrivers')} · {fmtTs(tl.first_record, false)} – {fmtTs(tl.last_record, false)}
      </p>
      {tl.records.length === 0 ? (
        <p className="text-xs text-muted">{t('oaTimelineEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-2 py-1.5">Start</th><th className="px-2 py-1.5">Ende</th>
                <th className="px-2 py-1.5 text-right">km Start</th><th className="px-2 py-1.5 text-right">km Ende</th>
                <th className="px-2 py-1.5 text-right">Δ km</th><th className="px-2 py-1.5">{t('oaColDriver')}</th><th className="px-2 py-1.5">{t('oaColPlate')}</th><th className="w-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {render(before, true)}
              <tr><td colSpan={8} className="bg-accent-light px-2 py-1 text-center font-mono text-[10px] font-bold text-accent">31.12. · {fmtTs(cutoff)}</td></tr>
              {render(after, false)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
