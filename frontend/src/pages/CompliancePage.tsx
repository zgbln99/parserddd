import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchDrivers,
  evaluateComplianceRange,
  setViolationStatus,
  createComplianceSignLink,
  type ComplianceRangeResponse,
  type ComplianceRangeViolation,
  type ComplianceSeverity,
  type ViolationStatus,
} from '../lib/api';
import type { Driver } from '../types';
import { formatDurationMinutes } from '../lib/format';
import { Spinner } from '../components/Spinner';

/**
 * Activity-based compliance page.
 *
 * Lets a dispatcher pick a driver + date range, runs the new compliance
 * engine on the matching DDD files, shows a filterable violation table,
 * and lets them generate a public sign link the driver opens in their
 * phone. Status (NEW / EXPLAINED / DISMISSED_FALSE_POSITIVE / SIGNED ...)
 * is persisted per-violation in ``violation_statuses``.
 *
 * The page is intentionally a thin client of:
 *   GET  /api/drivers                        - driver picker
 *   GET  /api/compliance/months              - file paths per month
 *   POST /api/compliance/violations/evaluate - the new range-based engine
 *   POST /api/compliance/violations/status   - status persistence
 *   POST /api/compliance/violations/sign-link- reuses the signing infra
 *
 * Parser, hour calculation and existing analysis flow are not touched.
 */

interface MonthBucket {
  month: string;
  files: { path: string; name: string; date: string }[];
}

const SEVERITY_ORDER: ComplianceSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const ALL_STATUSES: ViolationStatus[] = [
  'NEW', 'REVIEWED', 'EXPLAINED', 'DRIVER_NOTIFIED',
  'TRAINING_REQUIRED', 'DISMISSED_FALSE_POSITIVE', 'SIGNED',
];

const severityChip: Record<ComplianceSeverity, string> = {
  INFO: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  LOW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  MEDIUM: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  CRITICAL: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

function severityLabel(s: ComplianceSeverity): string {
  return { INFO: 'Info', LOW: 'Niski', MEDIUM: 'Średni', HIGH: 'Wysoki', CRITICAL: 'Krytyczny' }[s];
}

// Rules where actualMinutes < limitMinutes (rest / break / weekly rest):
// the engine returns excessMinutes as a positive deficit. We prefix "−" so
// the row reads as a deficit. Driving-time rules stay positive (overshoot).
const _DEFICIT_RULES = new Set<string>([
  'EU_561_DAILY_REST_SHORT',
  'EU_561_WEEKLY_REST_MISSING',
  'EU_561_WEEKLY_REST_SHORT',
  'EU_561_WEEKLY_REST_REDUCED',
]);

function differenceLabel(v: ComplianceRangeViolation): string {
  const value = formatDurationMinutes(v.excessMinutes);
  if (!value || !v.excessMinutes) return value;
  if (_DEFICIT_RULES.has(v.ruleCode)) return `− ${value}`;
  return `+ ${value}`;
}

function statusLabel(s: string): string {
  switch (s) {
    case 'NEW': return 'Nowe';
    case 'REVIEWED': return 'Przejrzane';
    case 'EXPLAINED': return 'Wyjaśnione';
    case 'DRIVER_NOTIFIED': return 'Wysłane do kierowcy';
    case 'TRAINING_REQUIRED': return 'Wymaga szkolenia';
    case 'DISMISSED_FALSE_POSITIVE': return 'Odrzucone (false-positive)';
    case 'SIGNED': return 'Podpisane';
    default: return s;
  }
}

function rowTitle(v: ComplianceRangeViolation): string {
  return v.titlePl || v.title || v.titleDe || v.ruleCode;
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export default function CompliancePage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComplianceRangeResponse | null>(null);
  const [signLink, setSignLink] = useState<string | null>(null);
  const [signLinkBusy, setSignLinkBusy] = useState(false);

  const [filterSeverity, setFilterSeverity] = useState<ComplianceSeverity | 'ALL'>('ALL');
  const [filterRule, setFilterRule] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<ViolationStatus | 'ALL'>('ALL');
  const [showRaw, setShowRaw] = useState(false);

  // ------------------------------------------------------------------
  // Load drivers on mount.
  // ------------------------------------------------------------------
  useEffect(() => {
    setDriversLoading(true);
    fetchDrivers()
      .then((data) => setDrivers(data?.drivers || []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDriversLoading(false));
  }, []);

  // ------------------------------------------------------------------
  // Find the DDD file paths covering the requested range. The /months
  // endpoint already lists every YYYY-MM bucket for a driver; we collect
  // file paths from buckets that overlap [dateFrom, dateTo].
  // ------------------------------------------------------------------
  const collectFilePaths = useCallback(async (driver: Driver, from: string, to: string): Promise<string[]> => {
    const res = await fetch(
      `/api/compliance/months?driver=${encodeURIComponent(driver.name)}`,
      { credentials: 'include' },
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    const months: MonthBucket[] = body.months || [];
    const fromMonth = monthOf(from);
    const toMonth = monthOf(to);
    return months
      .filter((m) => m.month >= fromMonth && m.month <= toMonth)
      .flatMap((m) => m.files.map((f) => f.path));
  }, []);

  const onEvaluate = useCallback(async () => {
    if (!selectedDriver) {
      setError('Wybierz kierowcę.');
      return;
    }
    if (!dateFrom || !dateTo) {
      setError('Wybierz zakres dat.');
      return;
    }
    if (dateFrom > dateTo) {
      setError('Data od musi być wcześniejsza niż data do.');
      return;
    }
    setError(null);
    setSignLink(null);
    setResult(null);
    setLoading(true);
    try {
      const file_paths = await collectFilePaths(selectedDriver, dateFrom, dateTo);
      if (file_paths.length === 0) {
        setError('Brak plików DDD w wybranym zakresie.');
        return;
      }
      const res = await evaluateComplianceRange({
        driver_card: selectedDriver.card_number,
        driver_name: selectedDriver.name,
        date_from: dateFrom,
        date_to: dateTo,
        file_paths,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedDriver, dateFrom, dateTo, collectFilePaths]);

  // ------------------------------------------------------------------
  // Filtered view.
  // ------------------------------------------------------------------
  const filteredViolations = useMemo(() => {
    if (!result) return [];
    return result.violations
      .filter((v) => filterSeverity === 'ALL' || v.severity === filterSeverity)
      .filter((v) => filterRule === 'ALL' || v.ruleCode === filterRule)
      .filter((v) => filterStatus === 'ALL' || (v.status || 'NEW') === filterStatus)
      .sort((a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
        || a.start.localeCompare(b.start),
      );
  }, [result, filterSeverity, filterRule, filterStatus]);

  const allRules = useMemo(() => {
    if (!result) return [];
    return Array.from(new Set(result.violations.map((v) => v.ruleCode))).sort();
  }, [result]);

  // ------------------------------------------------------------------
  // Status actions.
  // ------------------------------------------------------------------
  const applyStatus = useCallback(async (v: ComplianceRangeViolation, status: ViolationStatus) => {
    try {
      await setViolationStatus({
        violation_id: v.id || '',
        status,
        rule_code: v.ruleCode,
        driver_card: result?.driver_card || '',
      });
      setResult((prev) => prev ? {
        ...prev,
        violations: prev.violations.map((x) =>
          x.id === v.id ? { ...x, status } : x,
        ),
      } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [result?.driver_card]);

  const onCreateSignLink = useCallback(async () => {
    if (!result || filteredViolations.length === 0) return;
    setSignLinkBusy(true);
    setError(null);
    try {
      const periodLabel = `${result.period.from} – ${result.period.to}`;
      const res = await createComplianceSignLink({
        driver_card: result.driver_card,
        driver_name: result.driver_name,
        locale: 'de',
        period_label: periodLabel,
        violations: filteredViolations,
      });
      setSignLink(res.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSignLinkBusy(false);
    }
  }, [result, filteredViolations]);

  // ------------------------------------------------------------------
  // PDF: open the existing sign PDF for a token (renders the same
  // signature-ready document the driver will sign).
  // ------------------------------------------------------------------
  const pdfPreviewUrl = signLink ? signLink.replace('/sign/', '/sign/') + '?preview=1' : null;

  // ------------------------------------------------------------------
  // Render.
  // ------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <h1 className="text-xl font-semibold mb-1">Wykroczenia / Verstöße</h1>
      <p className="text-xs text-muted mb-4">
        Wykrywanie naruszeń EU 561 na karcie kierowcy. Wybierz kierowcę i zakres dat, kliknij „Sprawdź wykroczenia".
      </p>

      <div className="rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {/* Driver picker */}
          <div className="sm:col-span-2">
            <label className="text-xs text-muted">Kierowca</label>
            {driversLoading ? (
              <div className="mt-1"><Spinner /></div>
            ) : (
              <select
                value={selectedDriver?.card_number || ''}
                onChange={(e) => {
                  const card = e.target.value;
                  setSelectedDriver(drivers.find((d) => d.card_number === card) || null);
                }}
                className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm dark:bg-[#0c1726]"
                data-testid="driver-select"
              >
                <option value="">— wybierz —</option>
                {drivers.map((d) => (
                  <option key={d.card_number} value={d.card_number}>
                    {d.name} ({d.card_number})
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-xs text-muted">Data od</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm dark:bg-[#0c1726]"
              data-testid="date-from"
            />
          </div>
          <div>
            <label className="text-xs text-muted">Data do</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm dark:bg-[#0c1726]"
              data-testid="date-to"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onEvaluate}
            disabled={loading || !selectedDriver}
            data-testid="evaluate-button"
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Sprawdzam…' : 'Sprawdź wykroczenia'}
          </button>
          {result && (
            <button
              type="button"
              onClick={onCreateSignLink}
              disabled={signLinkBusy || filteredViolations.length === 0}
              className="rounded-lg border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed dark:text-primary-300"
              data-testid="sign-link-button"
            >
              {signLinkBusy ? 'Generuję link…' : 'Utwórz link do podpisu kierowcy'}
            </button>
          )}
        </div>

        {signLink && (
          <div className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm dark:border-green-800 dark:bg-green-900/30">
            <div className="font-medium">Link do podpisu wygenerowany:</div>
            <div className="mt-1 break-all">
              <a href={signLink} target="_blank" rel="noreferrer" className="text-primary-700 underline dark:text-primary-300">
                {signLink}
              </a>
              <button
                type="button"
                className="ml-3 text-xs underline"
                onClick={() => navigator.clipboard?.writeText(signLink)}
              >
                kopiuj
              </button>
            </div>
            <div className="mt-1 text-xs text-muted">
              Wyślij ten link kierowcy. Po podpisaniu wszystkie wybrane wykroczenia przejdą do statusu „Podpisane".
            </div>
          </div>
        )}

        {error && (
          <div
            className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
            data-testid="compliance-error"
          >
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="mt-4 rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="text-sm">
              <span className="text-muted">Okres:</span>{' '}
              <strong>{result.period.from} – {result.period.to}</strong>
            </div>
            <div className="text-sm">
              <span className="text-muted">Kierowca:</span>{' '}
              <strong>{result.driver_name || result.driver_card}</strong>
            </div>
            <div className="text-sm">
              <span className="text-muted">Pojazd:</span>{' '}
              <strong>{result.vehicle || '—'}</strong>
            </div>
            <div className="text-sm">
              <span className="text-muted">Wykroczenia:</span>{' '}
              <strong data-testid="compliance-count">{result.summary.count}</strong>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <div>
              <label className="text-[11px] text-muted">Poziom</label>
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value as ComplianceSeverity | 'ALL')}
                className="mt-1 w-full rounded border border-border bg-white px-2 py-1 text-xs dark:bg-[#0c1726]"
              >
                <option value="ALL">Wszystkie</option>
                <option value="MEDIUM">Średni</option>
                <option value="HIGH">Wysoki</option>
                <option value="CRITICAL">Krytyczny</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted">Reguła</label>
              <select
                value={filterRule}
                onChange={(e) => setFilterRule(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-white px-2 py-1 text-xs dark:bg-[#0c1726]"
              >
                <option value="ALL">Wszystkie</option>
                {allRules.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as ViolationStatus | 'ALL')}
                className="mt-1 w-full rounded border border-border bg-white px-2 py-1 text-xs dark:bg-[#0c1726]"
              >
                <option value="ALL">Wszystkie</option>
                {ALL_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>
          </div>

          {filteredViolations.length === 0 ? (
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-200" data-testid="compliance-empty">
              Nie wykryto wykroczeń pasujących do filtrów.
            </div>
          ) : (
            <div className="overflow-x-auto" data-testid="compliance-table">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-black/[0.04] dark:bg-white/10">
                    <th className="border border-border px-2 py-1 text-left">Poziom</th>
                    <th className="border border-border px-2 py-1 text-left">Kierowca</th>
                    <th className="border border-border px-2 py-1 text-left">Pojazd</th>
                    <th className="border border-border px-2 py-1 text-left">Reguła</th>
                    <th className="border border-border px-2 py-1 text-left">Opis</th>
                    <th className="border border-border px-2 py-1 text-left">Od</th>
                    <th className="border border-border px-2 py-1 text-left">Do</th>
                    <th className="border border-border px-2 py-1 text-right">Faktyczne</th>
                    <th className="border border-border px-2 py-1 text-right">Limit</th>
                    <th className="border border-border px-2 py-1 text-right">Różnica</th>
                    <th className="border border-border px-2 py-1 text-left">Podstawa prawna</th>
                    <th className="border border-border px-2 py-1 text-left">Status</th>
                    <th className="border border-border px-2 py-1 text-left">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredViolations.map((v) => (
                    <tr key={v.id || `${v.ruleCode}-${v.start}-${v.end}`}>
                      <td className="border border-border px-2 py-1">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityChip[v.severity]}`}>
                          {severityLabel(v.severity)}
                        </span>
                      </td>
                      <td className="border border-border px-2 py-1 whitespace-nowrap">
                        {v.driverId}
                      </td>
                      <td className="border border-border px-2 py-1 whitespace-nowrap">
                        {v.vehicleId || '—'}
                      </td>
                      <td className="border border-border px-2 py-1 font-mono text-[10px]">
                        {v.ruleCode}
                      </td>
                      <td className="border border-border px-2 py-1">
                        <div className="font-medium">{rowTitle(v)}</div>
                        {v.description && (
                          <div className="text-[10px] text-muted">{v.description}</div>
                        )}
                      </td>
                      <td className="border border-border px-2 py-1 whitespace-nowrap">{fmtDateTime(v.start)}</td>
                      <td className="border border-border px-2 py-1 whitespace-nowrap">{fmtDateTime(v.end)}</td>
                      <td className="border border-border px-2 py-1 text-right tabular-nums">
                        {formatDurationMinutes(v.actualMinutes)}
                      </td>
                      <td className="border border-border px-2 py-1 text-right tabular-nums">
                        {formatDurationMinutes(v.limitMinutes)}
                      </td>
                      <td className="border border-border px-2 py-1 text-right tabular-nums">
                        {differenceLabel(v)}
                      </td>
                      <td className="border border-border px-2 py-1 text-[10px]">{v.legalBasis}</td>
                      <td className="border border-border px-2 py-1 text-[10px]">
                        {statusLabel(v.status || 'NEW')}
                      </td>
                      <td className="border border-border px-2 py-1 text-[10px]">
                        <div className="flex flex-col gap-1">
                          <button type="button" className="underline text-left"
                            onClick={() => applyStatus(v, 'EXPLAINED')}>
                            Wyjaśnione
                          </button>
                          <button type="button" className="underline text-left"
                            onClick={() => applyStatus(v, 'DISMISSED_FALSE_POSITIVE')}>
                            Odrzuć (FP)
                          </button>
                          <button type="button" className="underline text-left"
                            onClick={() => applyStatus(v, 'DRIVER_NOTIFIED')}>
                            Wysłano do kierowcy
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pdfPreviewUrl && (
            <div className="mt-3 text-xs">
              <a href={pdfPreviewUrl} target="_blank" rel="noreferrer" className="underline text-primary-700 dark:text-primary-300">
                Podgląd PDF do podpisu →
              </a>
            </div>
          )}

          <div className="mt-3">
            <button type="button" className="text-xs text-muted underline-offset-2 hover:underline"
              onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Ukryj szczegóły techniczne' : 'Pokaż szczegóły techniczne'}
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-96 overflow-auto rounded bg-black/[0.04] p-2 text-[10px] dark:bg-white/5">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
